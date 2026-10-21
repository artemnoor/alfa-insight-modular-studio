from __future__ import annotations

import csv
import json
import os
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

import business_graph as graph


class BusinessGraphTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.data = self.root / "data"
        self.data.mkdir()
        self.profile_path = self.root / "df_Uid_data_hack.csv"
        self.link_path = self.root / "df_Fid_Uid_link_hack.csv"
        self.payment_path = self.root / "df_Uid_payment_hack.csv"
        self.db_path = self.data / "business_network.sqlite"

        def profile(company_id: str, group_id: str, *, city: str = "") -> dict[str, str]:
            row = {key: "" for key in graph.PROFILE_COLUMNS}
            row.update({"SYNTHETIC_U": company_id, "GROUP_ID": group_id, "CITY": city})
            return row

        self._write_csv(self.profile_path, graph.PROFILE_COLUMNS, [
            profile("U_A", "G_1", city="Москва"),
            profile("U_B", "G_1", city="Москва"),
            profile("U_C", ""),
            profile("U_D", "G_BAD", city="Омск"),
            profile("U_D", "G_BAD", city="Тула"),
            profile("U_SELF", ""),
            profile("U_DUP", "G_DUP"),
            profile("U_DUP", "G_DUP"),
            profile("U_DUP_PEER", "G_DUP"),
        ])
        self._write_csv(self.link_path, ["SYNTHETIC_F", "CITY_NAME", "RC_NAME", "SYNTHETIC_U"], [
            {"SYNTHETIC_F": "F_1", "CITY_NAME": "Москва", "RC_NAME": "Центр", "SYNTHETIC_U": "U_A"},
            {"SYNTHETIC_F": "F_1", "CITY_NAME": "Москва", "RC_NAME": "Центр", "SYNTHETIC_U": "U_B"},
            {"SYNTHETIC_F": "F_2", "CITY_NAME": "", "RC_NAME": "", "SYNTHETIC_U": "U_C"},
            {"SYNTHETIC_F": "F_1", "CITY_NAME": "Москва", "RC_NAME": "Центр", "SYNTHETIC_U": "U_A"},
        ])
        self._write_csv(self.payment_path, ["BENEFICIARY", "PAYER", "PAY_AMT", "PAY_CNT"], [
            {"BENEFICIARY": "U_B", "PAYER": "U_A", "PAY_AMT": "10.0", "PAY_CNT": "2"},
            {"BENEFICIARY": "U_C", "PAYER": "U_A", "PAY_AMT": "90.0", "PAY_CNT": "9"},
            {"BENEFICIARY": "U_A", "PAYER": "U_A", "PAY_AMT": "3.0", "PAY_CNT": "1"},
            {"BENEFICIARY": "U_A", "PAYER": "U_C", "PAY_AMT": "100.0", "PAY_CNT": "10"},
            {"BENEFICIARY": "U_C", "PAYER": "U_A", "PAY_AMT": "10.0", "PAY_CNT": "1"},
            {"BENEFICIARY": "U_A", "PAYER": "U_X", "PAY_AMT": "5.0", "PAY_CNT": "1"},
            {"BENEFICIARY": "U_A", "PAYER": "U_B", "PAY_AMT": "7.0", "PAY_CNT": "3"},
            {"BENEFICIARY": "U_C", "PAYER": "U_A", "PAY_AMT": "90.0", "PAY_CNT": "9"},
            {"BENEFICIARY": "U_SELF", "PAYER": "U_SELF", "PAY_AMT": "0.1", "PAY_CNT": "1"},
        ])
        self.patches = [
            patch.object(graph, "DATA_DIR", self.data),
            patch.object(graph, "DB_PATH", self.db_path),
            patch.object(graph, "PROFILE_CSV", self.profile_path),
            patch.object(graph, "PERSON_LINK_CSV", self.link_path),
            patch.object(graph, "PAYMENT_CSV", self.payment_path),
        ]
        for item in self.patches:
            item.start()
        graph.ensure_database(force=True)

    def tearDown(self) -> None:
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    @staticmethod
    def _write_csv(path: Path, columns: tuple[str, ...] | list[str], rows: list[dict[str, str]]) -> None:
        with path.open("w", encoding="utf-8-sig", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=columns, delimiter=";")
            writer.writeheader()
            writer.writerows(rows)

    def test_direction_sums_concentration_and_self_flow(self) -> None:
        network = graph.get_company_network("U_A", graph_depth=2)
        incoming = network["metrics"]["incoming"]
        outgoing = network["metrics"]["outgoing"]
        self.assertEqual(incoming["amount"], "115.0")
        self.assertEqual(incoming["external_amount"], "112.0")
        self.assertEqual(incoming["counterparty_count"], 3)
        self.assertEqual(incoming["top1_share"], "89.3%")
        self.assertEqual(outgoing["amount"], "203.0")
        self.assertEqual(outgoing["external_amount"], "200.0")
        self.assertEqual(outgoing["counterparty_count"], 2)
        self.assertEqual(outgoing["top1_share"], "95.0%")
        self.assertEqual(network["metrics"]["unique_counterparty_count"], 3)

        payment_edges = [edge for edge in network["graph"]["edges"] if edge["relation"] == "payment"]
        edge_to_c = next(edge for edge in payment_edges if edge["source"] == "U_A" and edge["target"] == "U_C")
        self.assertEqual(len({(edge["source"], edge["target"], edge["relation"]) for edge in payment_edges}), len(payment_edges))
        self.assertEqual(edge_to_c["source"], "U_A")
        self.assertEqual(edge_to_c["pay_amt"], "190.0")
        self.assertEqual(edge_to_c["pay_cnt"], 19)
        self.assertEqual(edge_to_c["source_record_count"], 3)
        self.assertEqual(edge_to_c["source_row_numbers"], [3, 6, 9])
        reverse_edge = next(edge for edge in payment_edges if edge["source"] == "U_B" and edge["target"] == "U_A")
        self.assertEqual(reverse_edge["pay_amt"], "7.0")
        self.assertTrue(any(edge["source"] == "U_A" and edge["target"] == "U_B" for edge in payment_edges))

    def test_group_person_and_missing_profile_links_keep_distinct_meanings(self) -> None:
        network = graph.get_company_network("U_A", graph_depth=2)
        self.assertEqual(network["profile_status"], "available")
        self.assertEqual(network["metrics"]["group_peer_count"], 1)
        self.assertEqual(network["metrics"]["shared_person_company_count"], 1)
        direct = network["direct_connections"]
        self.assertEqual(direct["same_group"][0]["company_id"], "U_B")
        self.assertEqual(direct["shared_person"][0]["company_id"], "U_B")
        self.assertEqual(direct["shared_person"][0]["shared_person_ids"], ["F_1"])
        self.assertEqual(direct["shared_person"][0]["shared_person_count"], 1)
        self.assertEqual(direct["shared_person"][0]["source_row_numbers"]["U_A"], [2, 5])
        self.assertEqual(direct["payment_incoming"][-1]["profile_status"], "missing_profile")
        unknown_node = next(node for node in network["graph"]["nodes"] if node["id"] == "U_X")
        self.assertEqual(unknown_node["profile_status"], "missing_profile")

    def test_conflicting_profile_is_preserved_but_not_joined_to_a_group(self) -> None:
        network = graph.get_company_network("U_D", graph_depth=1)
        self.assertEqual(network["profile_status"], "ambiguous")
        self.assertIsNone(network["group_id"])
        self.assertEqual(network["metrics"]["group_peer_count"], 0)
        status = graph.ensure_database()
        self.assertTrue(status["reused"])
        self.assertEqual(status["ambiguous_profiles"], 1)

    def test_model_context_contains_aggregates_but_not_person_ids_or_source_rows(self) -> None:
        context = graph.build_ai_context(graph.get_company_network("U_A", graph_depth=2))
        serialized = str(context)
        self.assertIn("U_C", serialized)
        self.assertIn("112.0", serialized)
        self.assertNotIn("F_1", serialized)
        self.assertNotIn("source_row", serialized)
        self.assertNotIn("Москва", serialized)
        self.assertIn("период и валюта", " ".join(context["limitations"]).lower())

    def test_same_size_same_mtime_csv_edit_invalidates_database_by_checksum(self) -> None:
        original_stat = self.profile_path.stat()
        original = self.profile_path.read_bytes()
        changed = original.replace("Москва".encode(), "Самара".encode(), 1)
        self.assertNotEqual(original, changed)
        self.assertEqual(len(original), len(changed))
        self.profile_path.write_bytes(changed)
        os.utime(self.profile_path, ns=(original_stat.st_atime_ns, original_stat.st_mtime_ns))

        result = graph.ensure_database()

        self.assertFalse(result["reused"])
        with closing(graph._connect(self.db_path)) as conn:
            profile = json.loads(conn.execute(
                "SELECT profile_json FROM companies WHERE company_id = 'U_A'",
            ).fetchone()[0])
        self.assertEqual(profile["CITY"], "Самара")

    def test_self_only_company_has_no_external_share_or_graph_edge(self) -> None:
        network = graph.get_company_network("U_SELF", graph_depth=2)
        self.assertEqual(network["metrics"]["incoming"]["amount"], "0.1")
        self.assertEqual(network["metrics"]["outgoing"]["amount"], "0.1")
        self.assertEqual(network["metrics"]["incoming"]["external_amount"], "0.0")
        self.assertEqual(network["metrics"]["outgoing"]["external_amount"], "0.0")
        self.assertEqual(network["metrics"]["unique_counterparty_count"], 0)
        self.assertIsNone(network["metrics"]["incoming"]["top1_share"])
        self.assertIsNone(network["metrics"]["outgoing"]["top3_share"])
        self.assertEqual(network["graph"]["nodes"], [{"id": "U_SELF", "depth": 0, "profile_status": "available"}])
        self.assertEqual(network["graph"]["edges"], [])

    def test_exact_duplicate_profiles_do_not_duplicate_group_membership(self) -> None:
        network = graph.get_company_network("U_DUP", graph_depth=1)
        self.assertEqual(network["profile_status"], "available")
        self.assertEqual(network["profile_row_count"], 2)
        self.assertEqual(network["metrics"]["group_peer_count"], 1)
        self.assertEqual(network["direct_connections"]["same_group"][0]["company_id"], "U_DUP_PEER")

    def test_graph_respects_node_cap_and_rejects_invalid_bounds(self) -> None:
        bounded = graph.get_graph("U_A", max_depth=2, max_nodes=1, per_relation_limit=50)
        self.assertEqual(len(bounded["nodes"]), 1)
        self.assertEqual(bounded["nodes"][0]["id"], "U_A")
        self.assertEqual(bounded["edges"], [])
        self.assertTrue(bounded["truncated"])

        for kwargs in (
            {"max_depth": 3},
            {"max_nodes": 0},
            {"max_nodes": -1},
            {"per_relation_limit": -1},
        ):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                graph.get_graph("U_A", **kwargs)
        with self.assertRaises(ValueError):
            graph.get_direct_connections("U_A", limit_per_relation=-1)
        with self.assertRaises(ValueError):
            graph.build_ai_context(graph.get_company_network("U_A"), top_n=-1)

        no_edges = graph.get_direct_connections("U_A", limit_per_relation=0)
        self.assertEqual(no_edges["payment_outgoing"], [])
        self.assertEqual(no_edges["counts"]["payment_outgoing"], 2)
        self.assertTrue(no_edges["truncated"])

        graph_two_hops = graph.get_graph("U_A", max_depth=2, max_nodes=2, per_relation_limit=3)
        node_ids = {node["id"] for node in graph_two_hops["nodes"]}
        self.assertLessEqual(len(node_ids), 2)
        self.assertTrue(all(edge["source"] in node_ids and edge["target"] in node_ids for edge in graph_two_hops["edges"]))
        self.assertLessEqual(max(node["depth"] for node in graph_two_hops["nodes"]), 2)
        self.assertTrue(graph_two_hops["truncated"])

    def test_invalid_numeric_values_fail_with_validation_errors(self) -> None:
        for value in ("NaN", "Infinity", "-Infinity", "922337203685477580.8"):
            with self.subTest(field="PAY_AMT", value=value), self.assertRaises(ValueError):
                graph._amount_units(value, 42)
        for value in ("NaN", "Infinity", "-Infinity", "9223372036854775808", "1.5"):
            with self.subTest(field="PAY_CNT", value=value), self.assertRaises(ValueError):
                graph._count_value(value, 43)
        self.assertEqual(graph._amount_units("0,3", 44), 3)

    def test_concurrent_forced_imports_do_not_share_a_temporary_database(self) -> None:
        barrier = threading.Barrier(2)
        import_to = graph._import_to

        def synchronized_import(path: Path, fingerprints: dict[str, dict[str, object]]) -> dict[str, object]:
            barrier.wait(timeout=5)
            return import_to(path, fingerprints)

        with patch.object(graph, "_import_to", side_effect=synchronized_import):
            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(graph.ensure_database, force=True) for _ in range(2)]
                results = [future.result(timeout=15) for future in futures]

        self.assertEqual([result["payment_rows"] for result in results], [9, 9])
        with closing(graph._connect(self.db_path)) as conn:
            self.assertEqual(conn.execute("PRAGMA integrity_check").fetchone()[0], "ok")
        self.assertFalse(list(self.data.glob(".*.importing")))

    def test_failed_reimport_keeps_the_last_good_database(self) -> None:
        original = self.payment_path.read_text(encoding="utf-8-sig")
        self.payment_path.write_text(original.replace("90.0", "NaN", 1), encoding="utf-8-sig")

        with self.assertRaisesRegex(ValueError, "PAY_AMT"):
            graph.ensure_database(force=True)

        with closing(graph._connect(self.db_path)) as conn:
            self.assertEqual(conn.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM payments").fetchone()[0], 9)
        self.assertFalse(list(self.data.glob(".*.importing")))


if __name__ == "__main__":
    unittest.main()
