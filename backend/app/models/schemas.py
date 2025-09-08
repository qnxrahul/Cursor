from pydantic import BaseModel, EmailStr, Field


class ServiceRequest(BaseModel):
    name: str = Field(..., description="Full name")
    email: EmailStr
    issue_details: str
    type: str
    urgency: str
    location: str


class ChatUserMessage(BaseModel):
    thread_id: str | None = None
    message: str

