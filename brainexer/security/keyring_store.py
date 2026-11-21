from __future__ import annotations

import sys
from typing import Optional, Protocol

from ..core.exceptions import KeyringError


SERVICE_NAME = "Anki BrainExer"


class SecretBackend(Protocol):
    def get(self, service: str, account: str) -> Optional[str]: ...
    def set(self, service: str, account: str, secret: str) -> None: ...
    def delete(self, service: str, account: str) -> None: ...


class PythonKeyringBackend:
    def __init__(self) -> None:
        try:
            import keyring
        except ImportError as exc:
            raise KeyringError("Python keyring chưa được cài và hệ điều hành chưa có backend tích hợp.") from exc
        self._keyring = keyring

    def get(self, service: str, account: str) -> Optional[str]:
        return self._keyring.get_password(service, account)

    def set(self, service: str, account: str, secret: str) -> None:
        self._keyring.set_password(service, account, secret)

    def delete(self, service: str, account: str) -> None:
        try:
            self._keyring.delete_password(service, account)
        except self._keyring.errors.PasswordDeleteError:
            return


class WindowsCredentialBackend:
    """Minimal Windows Credential Manager adapter using only the standard library."""

    def __init__(self) -> None:
        if sys.platform != "win32":
            raise KeyringError("Windows Credential Manager chỉ dùng được trên Windows.")
        import ctypes
        from ctypes import wintypes

        class Credential(ctypes.Structure):
            _fields_ = [
                ("Flags", wintypes.DWORD),
                ("Type", wintypes.DWORD),
                ("TargetName", wintypes.LPWSTR),
                ("Comment", wintypes.LPWSTR),
                ("LastWritten", wintypes.FILETIME),
                ("CredentialBlobSize", wintypes.DWORD),
                ("CredentialBlob", ctypes.POINTER(ctypes.c_ubyte)),
                ("Persist", wintypes.DWORD),
                ("AttributeCount", wintypes.DWORD),
                ("Attributes", ctypes.c_void_p),
                ("TargetAlias", wintypes.LPWSTR),
                ("UserName", wintypes.LPWSTR),
            ]

        self._ctypes = ctypes
        self._credential_type = Credential
        self._advapi32 = ctypes.WinDLL("Advapi32.dll", use_last_error=True)
        self._advapi32.CredWriteW.argtypes = [ctypes.POINTER(Credential), wintypes.DWORD]
        self._advapi32.CredWriteW.restype = wintypes.BOOL
        self._advapi32.CredReadW.argtypes = [
            wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
            ctypes.POINTER(ctypes.POINTER(Credential)),
        ]
        self._advapi32.CredReadW.restype = wintypes.BOOL
        self._advapi32.CredDeleteW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD]
        self._advapi32.CredDeleteW.restype = wintypes.BOOL
        self._advapi32.CredFree.argtypes = [ctypes.c_void_p]
        self._advapi32.CredFree.restype = None

    @staticmethod
    def _target(service: str, account: str) -> str:
        return "{}/{}".format(service, account)

    def get(self, service: str, account: str) -> Optional[str]:
        ctypes = self._ctypes
        pointer = ctypes.POINTER(self._credential_type)()
        ok = self._advapi32.CredReadW(self._target(service, account), 1, 0, ctypes.byref(pointer))
        if not ok:
            error = ctypes.get_last_error()
            if error == 1168:
                return None
            raise KeyringError("Không đọc được Windows Credential Manager (mã {}).".format(error))
        try:
            credential = pointer.contents
            blob = ctypes.string_at(credential.CredentialBlob, credential.CredentialBlobSize)
            return blob.decode("utf-16-le")
        finally:
            self._advapi32.CredFree(pointer)

    def set(self, service: str, account: str, secret: str) -> None:
        ctypes = self._ctypes
        encoded = secret.encode("utf-16-le")
        blob = ctypes.create_string_buffer(encoded)
        credential = self._credential_type()
        credential.Type = 1
        credential.TargetName = self._target(service, account)
        credential.CredentialBlobSize = len(encoded)
        credential.CredentialBlob = ctypes.cast(blob, ctypes.POINTER(ctypes.c_ubyte))
        credential.Persist = 2
        credential.UserName = account
        if not self._advapi32.CredWriteW(ctypes.byref(credential), 0):
            raise KeyringError("Không ghi được Windows Credential Manager (mã {}).".format(ctypes.get_last_error()))

    def delete(self, service: str, account: str) -> None:
        if not self._advapi32.CredDeleteW(self._target(service, account), 1, 0):
            error = self._ctypes.get_last_error()
            if error != 1168:
                raise KeyringError("Không xóa được Windows Credential Manager (mã {}).".format(error))


class KeyringStore:
    def __init__(self, account: str = "default", backend: Optional[SecretBackend] = None) -> None:
        self.profile = account or "default"
        self.backend = backend or _default_backend()

    def _account(self, provider: str) -> str:
        provider = provider.strip().casefold()
        if provider not in ("openai", "deepseek", "gemini"):
            raise KeyringError("Provider không hợp lệ: {}".format(provider))
        return "{}-api-key/{}".format(provider, self.profile)

    def get_api_key(self, provider: str = "openai") -> Optional[str]:
        try:
            return self.backend.get(SERVICE_NAME, self._account(provider))
        except KeyringError:
            raise
        except Exception as exc:
            raise KeyringError("Không đọc được API key từ OS Keyring: {}".format(exc)) from exc

    def set_api_key(self, value: str, provider: str = "openai") -> None:
        value = value.strip()
        if not value:
            raise KeyringError("API key không được để trống.")
        try:
            self.backend.set(SERVICE_NAME, self._account(provider), value)
        except KeyringError:
            raise
        except Exception as exc:
            raise KeyringError("Không lưu được API key vào OS Keyring: {}".format(exc)) from exc

    def delete_api_key(self, provider: str = "openai") -> None:
        try:
            self.backend.delete(SERVICE_NAME, self._account(provider))
        except KeyringError:
            raise
        except Exception as exc:
            raise KeyringError("Không xóa được API key khỏi OS Keyring: {}".format(exc)) from exc


def _default_backend() -> SecretBackend:
    if sys.platform == "win32":
        return WindowsCredentialBackend()
    return PythonKeyringBackend()
