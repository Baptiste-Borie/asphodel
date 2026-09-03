package com.asphodel.forgebridge;

final class ExternalMatchException extends RuntimeException {
    private final String code;
    private final Object details;

    ExternalMatchException(String code, String message) {
        this(code, message, null);
    }

    ExternalMatchException(String code, String message, Object details) {
        super(message);
        this.code = code;
        this.details = details;
    }

    String code() {
        return code;
    }

    Object details() {
        return details;
    }
}
