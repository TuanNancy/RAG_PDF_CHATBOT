"""
User-facing messages for API responses.

Detailed diagnostics should stay in server logs. These helpers return safe text for end users.
"""


def chat_error_message(language: str = "vi") -> str:
    if language == "vi":
        return "Không thể tạo câu trả lời lúc này. Vui lòng thử lại sau."
    return "Unable to generate an answer right now. Please try again later."


def chat_no_results_message(language: str = "vi") -> str:
    if language == "vi":
        return (
            "Không tìm thấy đoạn nào trong tài liệu đủ liên quan để trả lời câu hỏi này. "
            "Bạn hãy đặt câu hỏi cụ thể hơn hoặc hỏi sát với nội dung của file."
        )
    return (
        "No sufficiently relevant passages were found in this document for that question. "
        "Try asking a more specific question about the file."
    )


def upload_processing_error_message() -> str:
    return (
        "Không thể xử lý file PDF này lúc này. "
        "Vui lòng thử lại sau hoặc kiểm tra xem file có hợp lệ hay không."
    )


def upload_invalid_file_type_message() -> str:
    return "Chi chap nhan file PDF."


def upload_invalid_extension_message() -> str:
    return "File tải lên phải có đuôi .pdf."


def upload_file_too_large_message(max_size_mb: int) -> str:
    return f"File vượt quá giới hạn {max_size_mb} MB."


def upload_empty_file_message() -> str:
    return "File tải lên đang rỗng."


def upload_invalid_user_message() -> str:
    return "Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại."


def upload_validation_error_message(raw: str | None = None) -> str:
    message = (raw or "").lower()
    if "corrupt" in message or "unreadable" in message:
        return "File PDF bị hỏng hoặc không đọc được."
    if "no text chunks" in message:
        return "Không trích xuất được nội dung văn bản từ file PDF này."
    if "no pages" in message:
        return "Không đọc được nội dung trong file PDF này."
    return upload_processing_error_message()


def auth_service_unavailable_message() -> str:
    return "Dịch vụ xác thực tạm thời không khả dụng. Vui lòng thử lại sau."


def auth_not_configured_message() -> str:
    return "Hệ thống xác thực chưa sẵn sàng. Vui lòng liên hệ quản trị viên."


def auth_missing_header_message() -> str:
    return "Thiếu thông tin xác thực. Vui lòng đăng nhập lại."


def auth_invalid_header_message() -> str:
    return "Thông tin xác thực không hợp lệ. Vui lòng đăng nhập lại."


def auth_invalid_token_message() -> str:
    return "Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại."


def auth_invalid_user_payload_message() -> str:
    return "Không xác minh được tài khoản hiện tại. Vui lòng đăng nhập lại."


def chat_query_required_message(language: str = "vi") -> str:
    if language == "vi":
        return "Vui lòng nhập câu hỏi."
    return "Query is required."


def chat_document_required_message(language: str = "vi") -> str:
    if language == "vi":
        return "Vui lòng chọn tài liệu trước khi chat."
    return "Document ID is required."


def chat_invalid_model_message(language: str = "vi") -> str:
    if language == "vi":
        return "Mô hình đã chọn không được hỗ trợ."
    return "The selected model is not supported."
