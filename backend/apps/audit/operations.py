from django.db import migrations


class AuditTrigger(migrations.RunSQL):
    def __init__(self, table, exclude=()):
        if not table.replace('_', '').isalnum():
            raise ValueError('Nombre de tabla inválido.')
        excluded = ', '.join(
            "'" + column.replace("'", "''") + "'" for column in exclude
        )
        arguments = f'({excluded})' if excluded else '()'
        trigger_name = f'{table}_audit'
        # CREATE OR REPLACE preserves consistent behavior for migrations that already use this operation.
        sql = (
            f'CREATE OR REPLACE TRIGGER {trigger_name} '
            f'AFTER INSERT OR UPDATE OR DELETE ON {table} '
            f'FOR EACH ROW EXECUTE FUNCTION audit_row_change{arguments};'
            f' CREATE OR REPLACE TRIGGER {trigger_name}_no_truncate '
            f'BEFORE TRUNCATE ON {table} '
            f'FOR EACH STATEMENT EXECUTE FUNCTION audit_rowchange_append_only();'
        )
        reverse_sql = (
            f'DROP TRIGGER IF EXISTS {trigger_name}_no_truncate ON {table}; '
            f'DROP TRIGGER IF EXISTS {trigger_name} ON {table};'
        )
        super().__init__(sql, reverse_sql)
