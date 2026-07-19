"""Shared pytest configuration using isolated temporary resources."""

import os
import shutil
import tempfile
from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker


TEST_ROOT = Path(tempfile.mkdtemp(prefix="kp_awaz_tests_"))
TEST_DATABASE = TEST_ROOT / "test_kp_awaz.db"
TEST_STORAGE = TEST_ROOT / "storage"
TEST_RAW_AUDIO_STORAGE = TEST_STORAGE / "raw-audio"
TEST_ADMIN_API_KEY = "test-admin-key"
TEST_SUPABASE_URL = "https://test-project.supabase.co"
TEST_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key"
TEST_SUPABASE_SECRET_KEY = "test-server-secret-key"

os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DATABASE}"
os.environ["STORAGE_ROOT"] = str(TEST_STORAGE)
os.environ["RAW_AUDIO_STORAGE_ROOT"] = str(TEST_RAW_AUDIO_STORAGE)
os.environ["ADMIN_API_KEY"] = TEST_ADMIN_API_KEY
os.environ["SUPABASE_URL"] = TEST_SUPABASE_URL
os.environ["SUPABASE_PUBLISHABLE_KEY"] = TEST_SUPABASE_PUBLISHABLE_KEY
os.environ["SUPABASE_SECRET_KEY"] = TEST_SUPABASE_SECRET_KEY
os.environ["SUPABASE_AUTH_TIMEOUT_SECONDS"] = "1"

from app.database import Base, engine  # noqa: E402
from app.dependencies import get_db, get_supabase_auth_client  # noqa: E402
from app.main import app  # noqa: E402
from app.services.supabase_auth import (  # noqa: E402
    AuthenticatedUser,
    InvalidAccessTokenError,
)


TEST_USER_ID = "0d5dd8f5-93df-462b-b234-a16973089092"
TEST_AUTHORIZATION = {"Authorization": "Bearer test-access-token"}


class StubAuthClient:
    """Network-free Supabase dependency for authenticated endpoint tests."""

    def __init__(
        self,
        *,
        user: AuthenticatedUser | None = None,
        invalid: bool = False,
    ) -> None:
        self.user = user
        self.invalid = invalid

    async def get_user(self, _access_token: str) -> AuthenticatedUser:
        if self.invalid:
            raise InvalidAccessTokenError()
        if self.user is None:
            raise AssertionError("A test authenticated user is required")
        return self.user


def authenticate_test_user(
    user_id: str = TEST_USER_ID,
    *,
    email: str | None = "person@example.com",
    provider: str | None = "google",
) -> AuthenticatedUser:
    """Configure one verified user without accepting identity from a request."""

    authenticated_user = AuthenticatedUser(
        id=user_id,
        email=email,
        provider=provider,
    )
    stub = StubAuthClient(user=authenticated_user)
    app.dependency_overrides[get_supabase_auth_client] = lambda: stub
    return authenticated_user


def reject_test_access_token() -> None:
    """Configure the Supabase dependency to reject the supplied bearer token."""

    stub = StubAuthClient(invalid=True)
    app.dependency_overrides[get_supabase_auth_client] = lambda: stub


TestingSessionLocal = sessionmaker(
    bind=engine,
    class_=Session,
    autoflush=False,
    expire_on_commit=False,
)


@pytest.fixture(scope="session", autouse=True)
def database_schema() -> Generator[None, None, None]:
    """Create and remove the schema in the temporary test database."""

    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)
    engine.dispose()
    shutil.rmtree(TEST_ROOT, ignore_errors=True)


@pytest.fixture(autouse=True)
def clean_database(database_schema: None) -> Generator[None, None, None]:
    """Give every test a predictable, empty database."""

    def remove_all_records() -> None:
        with engine.begin() as connection:
            for table in reversed(Base.metadata.sorted_tables):
                connection.execute(table.delete())

    remove_all_records()
    yield
    remove_all_records()


@pytest.fixture(autouse=True)
def clean_test_storage() -> Generator[None, None, None]:
    """Keep every test's import and audio files in temporary storage."""

    shutil.rmtree(TEST_STORAGE, ignore_errors=True)
    TEST_STORAGE.mkdir(parents=True, exist_ok=True)
    yield
    shutil.rmtree(TEST_STORAGE, ignore_errors=True)


@pytest.fixture()
def test_storage_root() -> Path:
    """Expose the configured temporary storage root for assertions."""

    return TEST_STORAGE


@pytest.fixture()
def db_session(database_schema: None) -> Generator[Session, None, None]:
    """Provide a direct session connected only to the temporary test database."""

    database = TestingSessionLocal()
    try:
        yield database
    finally:
        database.rollback()
        database.close()


@pytest.fixture()
def client(database_schema: None) -> Generator[TestClient, None, None]:
    """Return a TestClient with an isolated database dependency."""

    def override_get_db() -> Generator[Session, None, None]:
        database = TestingSessionLocal()
        try:
            yield database
        finally:
            database.close()

    app.dependency_overrides[get_db] = override_get_db

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()
