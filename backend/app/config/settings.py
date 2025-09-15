from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "service-request-ai"
    api_prefix: str = "/api"
    cors_origins: list[str] = ["http://localhost:4200", "http://127.0.0.1:4200", "*"]

    # OpenRouter
    openrouter_api_key: str | None = None
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_model: str = "meta-llama/llama-3.1-8b-instruct:free"

    class Config:
        env_file = ".env"


settings = Settings()

