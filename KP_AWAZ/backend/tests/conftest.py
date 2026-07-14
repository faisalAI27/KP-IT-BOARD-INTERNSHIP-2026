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
TEST_ADMIN_API_KEY = "test-admin-key"

os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DATABASE}"
os.environ["STORAGE_ROOT"] = str(TEST_STORAGE)
os.environ["ADMIN_API_KEY"] = TEST_ADMIN_API_KEY

from app.database import Base, engine  # noqa: E402
from app.dependencies import get_db  # noqa: E402
from app.main import app  # noqa: E402


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
    """Keep every test's import files inside an empty temporary storage root."""

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
