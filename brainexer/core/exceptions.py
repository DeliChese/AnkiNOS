"""Domain exceptions shown as friendly messages by the UI."""


class BrainExerError(Exception):
    pass


class ConfigurationError(BrainExerError):
    pass


class KeyringError(BrainExerError):
    pass


class APIError(BrainExerError):
    pass


class ResponseValidationError(BrainExerError):
    pass


class RateLimitExceeded(BrainExerError):
    pass


class InsufficientDataError(BrainExerError):
    pass
