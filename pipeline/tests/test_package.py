import riptide_pipeline


def test_package_imports_and_has_a_version() -> None:
    assert riptide_pipeline.__version__
