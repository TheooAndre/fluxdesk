"""Preflight never invokes strategy code or opens holdout."""
import importlib.util
import json
import unittest
import tempfile
import subprocess
import sys
from pathlib import Path
from datetime import datetime, timedelta, timezone

spec = importlib.util.spec_from_file_location('audit_inputs', Path(__file__).parents[1] / 'audit_inputs.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def fixture(root, count=4382):
    (root/'bars').mkdir()
    (root/'funding').mkdir()
    start=datetime(2022,1,1,tzinfo=timezone.utc)
    stamp=lambda t:t.isoformat()
    manifest={'venue':'binance','contract_type':'linear_perpetual','quote_currency':'USDT','funding_complete':True,'universe_point_in_time':True,'data_vendor':'synthetic test only','extracted_at_utc':stamp(start+timedelta(hours=count*4+4)), 'fee_evidence':{'source':'synthetic fixture','account_tier':'fixture','observed_at_utc':stamp(start),'maker_bps':2,'taker_bps':4}}
    (root/'manifest.json').write_text(json.dumps(manifest))
    for symbol in ['A','B']:
        (root/'bars'/f'{symbol}.csv').write_text('timestamp,open,high,low,close,volume\n'+''.join(f'{stamp(start+timedelta(hours=i*4))},100,101,99,100,10\n' for i in range(count)))
        (root/'funding'/f'{symbol}.csv').write_text('timestamp,rate\n'+''.join(f'{stamp(start+timedelta(hours=i*8))},0.0001\n' for i in range(count//2)))
    (root/'membership.csv').write_text('timestamp,symbol,active,linear,quote,open_interest_usd,volume_24h_usd\n'+''.join(f'{stamp(start+timedelta(days=i))},{symbol},true,true,USDT,10000000,50000000\n' for i in range(0,732,7) for symbol in ['A','B']))



class InputAuditTests(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root=Path(self.directory.name)

    def test_structural_check_is_not_certification_and_never_writes(self):
        tmp_path=self.root
        fixture(tmp_path)
        before={str(p.relative_to(tmp_path)):p.read_bytes() for p in tmp_path.rglob('*') if p.is_file()}
        report=audit.audit_folder(tmp_path)
        assert report['status']=='structural_checks_only'
        assert report['holdout_opened'] is False and report['research_run'] is False
        assert report['independent_funding_and_pit_audit'] is False
        assert report['trading_authorized'] is False
        assert before=={str(p.relative_to(tmp_path)):p.read_bytes() for p in tmp_path.rglob('*') if p.is_file()}
        manifest=json.loads((tmp_path/'manifest.json').read_text())
        manifest['fee_evidence']['taker_bps']=5
        (tmp_path/'manifest.json').write_text(json.dumps(manifest))
        assert audit.audit_folder(tmp_path)['audit_input_sha256']!=report['audit_input_sha256']


    def test_missing_inputs_are_reported_together(self):
        tmp_path=self.root
        report=audit.audit_folder(tmp_path)
        assert report['status']=='blocked'
        assert {'invalid_manifest','invalid_membership','requires_2_to_200_histories','missing_or_invalid_fee_evidence'}.issubset(report['issue_counts'])


    def test_rejects_truthy_manifest_claims_and_naive_timestamps(self):
        tmp_path=self.root
        fixture(tmp_path,80)
        manifest=json.loads((tmp_path/'manifest.json').read_text())
        manifest['funding_complete']='true'
        (tmp_path/'manifest.json').write_text(json.dumps(manifest))
        p=tmp_path/'bars'/'A.csv'
        p.write_text(p.read_text().replace('+00:00',''))
        report=audit.audit_folder(tmp_path)
        assert report['status']=='blocked'
        assert 'unverified_funding_complete' in report['issue_counts']
        assert 'invalid_bars' in report['issue_counts']
        assert 'less_than_two_years_of_history' in report['issue_counts']


    def test_reports_missing_delisted_history_duplicate_membership_and_funding(self):
        tmp_path=self.root
        fixture(tmp_path)
        p=tmp_path/'membership.csv'
        p.write_text(p.read_text()+p.read_text().splitlines()[1]+'\n2022-01-01T00:00:00Z,DELISTED,true,true,USDT,1,1\n')
        (tmp_path/'funding'/'A.csv').unlink()
        report=audit.audit_folder(tmp_path)
        assert {'duplicate_membership','active_market_missing_history','missing_or_invalid_funding'}.issubset(report['issue_counts'])


    def test_refuses_symlink_inputs_and_file_limits(self):
        tmp_path=self.root
        fixture(tmp_path,80)
        p=tmp_path/'funding'/'B.csv'
        p.unlink();p.symlink_to(tmp_path/'funding'/'A.csv')
        assert 'missing_or_invalid_funding' in audit.audit_folder(tmp_path)['issue_counts']
        old=audit.MAX_FILE
        self.addCleanup(setattr,audit,'MAX_FILE',old)
        audit.MAX_FILE=5
        assert audit.audit_folder(tmp_path)['status']=='blocked'


    def test_error_status_survives_truncated_issue_details(self):
        tmp_path=self.root
        fixture(tmp_path,100)
        p=tmp_path/'bars'/'A.csv'
        p.write_text(p.read_text().replace(',100,101,99,100,10',',100,90,99,100,10'))
        report=audit.audit_folder(tmp_path)
        assert report['status']=='blocked' and report['issues_truncated']
        assert len(report['issues'])==100

    def test_cli_is_json_only_and_does_not_create_reports(self):
        before=list(self.root.iterdir())
        result=subprocess.run([sys.executable,str(Path(__file__).parents[1]/'audit_inputs.py'),str(self.root)],capture_output=True,text=True,timeout=10)
        assert result.returncode==2
        report=json.loads(result.stdout)
        assert report['holdout_opened'] is False and report['research_run'] is False
        assert list(self.root.iterdir())==before

    def test_fee_claims_require_numeric_rates_and_documented_tier(self):
        fixture(self.root)
        p=self.root/'manifest.json'
        value=json.loads(p.read_text())
        value['fee_evidence']['taker_bps']='4'
        p.write_text(json.dumps(value))
        assert 'missing_or_invalid_fee_evidence' in audit.audit_folder(self.root)['issue_counts']

if __name__=='__main__':
    unittest.main()
