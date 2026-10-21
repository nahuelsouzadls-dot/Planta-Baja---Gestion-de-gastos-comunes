# Root-level conftest.py (backend/conftest.py) holds all shared fixtures.
# This file exists so that the tests/ directory is recognised as a test package
# and any future tests-only fixtures can be added here.
from conftest import (  # noqa: F401
    apartment,
    building,
    monthly_expense,
    owner_resident,
    owner_user,
    tenant_resident,
    tenant_user,
)
