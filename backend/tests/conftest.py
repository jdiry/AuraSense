"""Shared test setup."""
import pytest

import backend.main as main


@pytest.fixture(autouse=True)
def no_real_board(monkeypatch):
    """Tests never touch a real board, whatever the local .env says.

    Tests that want a board install a fake one (see test_device_integration.py).
    """
    monkeypatch.setattr(main, "DEVICE_ADDRESS", None)
