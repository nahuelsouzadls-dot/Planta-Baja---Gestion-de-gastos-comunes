from django.core.management.base import BaseCommand

from apps.storage.services import cleanup_orphan_uploads


class Command(BaseCommand):
    help = 'Borra del almacenamiento los comprobantes subidos que nunca se registraron.'

    def handle(self, *args, **options):
        self.stdout.write(f'Archivos huérfanos borrados: {cleanup_orphan_uploads()}')
