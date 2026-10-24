from django.db import migrations


BUSINESS_TABLES = (
    'accounts_user',
    'accounts_organization',
    'accounts_orgmembership',
    'buildings_building',
    'buildings_unit',
    'buildings_expenseconcept',
    'people_person',
    'people_occupancy',
    'settlements_settlement',
    'settlements_settlementitem',
    'ledger_ledgerentry',
    'ledger_receipt',
    'ledger_receiptallocation',
    'communications_notice',
    'communications_claim',
    'communications_claimmessage',
    'communications_task',
)


def _sql(action):
    statements = []
    for table in BUSINESS_TABLES:
        trigger = f'{table}_audit_no_truncate'
        if action == 'create':
            statements.append(
                f"""
                CREATE OR REPLACE TRIGGER {trigger}
                BEFORE TRUNCATE ON {table}
                FOR EACH STATEMENT
                EXECUTE FUNCTION audit_rowchange_append_only();
                """
            )
        else:
            statements.append(f'DROP TRIGGER IF EXISTS {trigger} ON {table};')
    return '\n'.join(statements)


class Migration(migrations.Migration):
    dependencies = [
        ('audit', '0002_auditlog'),
        ('communications', '0001_initial'),
        ('ledger', '0004_harden_entry_constraints'),
        ('settlements', '0003_harden_issued_triggers'),
    ]

    operations = [
        migrations.RunSQL(_sql('create'), _sql('drop')),
    ]
