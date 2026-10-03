"""Worker unit tests — no live Redis required."""

from __future__ import annotations

from worker_tasks.terrain import compare_grids


def test_compare_grids_cut_and_fill():
    # 2x2 nodes → 1 cell. Existing flat 10, proposed dips to 7 → cut.
    existing = {
        "grid_size": 10.0,
        "origin": [0.0, 0.0],
        "nodes": [
            [10.0, 10.0],
            [10.0, 10.0],
        ],
    }
    proposed = {
        "grid_size": 10.0,
        "origin": [0.0, 0.0],
        "nodes": [
            [7.0, 7.0],
            [7.0, 7.0],
        ],
    }
    result = compare_grids(existing, proposed)
    assert result["cells_evaluated"] == 1
    assert result["cut_bcy"] > 0
    assert result["fill_bcy"] == 0
    # cell 100 sf * 3 ft / 27 = 11.111 CY
    assert abs(result["cut_bcy"] - (100 * 3 / 27)) < 0.01


def test_compare_grids_fill():
    existing = {
        "grid_size": 5.0,
        "origin": [0, 0],
        "nodes": [[0.0, 0.0], [0.0, 0.0]],
    }
    proposed = {
        "grid_size": 5.0,
        "origin": [0, 0],
        "nodes": [[2.0, 2.0], [2.0, 2.0]],
    }
    result = compare_grids(existing, proposed)
    assert result["fill_bcy"] > 0
    assert result["cut_bcy"] == 0
    assert result["worker"] == "celery"


def test_compare_grids_rejects_mismatch():
    try:
        compare_grids(
            {"grid_size": 5.0, "origin": [0, 0], "nodes": [[0.0]]},
            {"grid_size": 10.0, "origin": [0, 0], "nodes": [[0.0]]},
        )
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "grid mismatch" in str(exc)
