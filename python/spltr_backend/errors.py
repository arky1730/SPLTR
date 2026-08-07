class ProcessingError(Exception):
    """A safe, actionable error suitable for display to the user."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code

