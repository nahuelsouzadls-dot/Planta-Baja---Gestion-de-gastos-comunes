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
        sql = (
            f'CREATE TRIGGER {trigger_name} '
            f'AFTER INSERT OR UPDATE OR DELETE ON {table} '
            f'FOR EACH ROW EXECUTE FUNCTION audit_row_change{arguments};'
        )
        reverse_sql = f'DROP TRIGGER IF EXISTS {trigger_name} ON {table};'
        super().__init__(sql, reverse_sql)
