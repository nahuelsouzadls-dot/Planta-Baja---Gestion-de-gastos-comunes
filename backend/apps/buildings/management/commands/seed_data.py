from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from apps.buildings.models import Apartment, Building
from apps.expenses.models import MonthlyExpense
from apps.ledger.models import Movement
from apps.residents.models import Resident

User = get_user_model()

APARTMENTS = [
    # (number, floor, coefficient, is_rented)
    ('101', 1, '0.08600000', False),
    ('102', 1, '0.08300000', True),
    ('103', 1, '0.08000000', True),
    ('104', 1, '0.08400000', False),
    ('201', 2, '0.08600000', True),
    ('202', 2, '0.08300000', False),
    ('203', 2, '0.08000000', True),
    ('204', 2, '0.08400000', False),
    ('301', 3, '0.08700000', False),
    ('302', 3, '0.08300000', True),
    ('303', 3, '0.08000000', False),
    ('304', 3, '0.08400000', True),
]

RESIDENTS = [
    # (username, email, first_name, last_name, apt_number, role)
    ('jpérez',    'jperez@example.com',    'Juan',    'Pérez',    '101', 'owner'),
    ('mgarcía_i', 'mgarcia.inq@example.com','María',  'García',   '102', 'tenant'),
    ('mgarcía_p', 'mgarcia.prop@example.com','Miguel', 'García',  '102', 'owner'),
    ('crodríguez','crodriguez@example.com', 'Carlos',  'Rodríguez','103', 'tenant'),
    ('agonzález_p','agonzalez.p@example.com','Ana',   'González', '103', 'owner'),
    ('lfernández','lfernandez@example.com', 'Luis',    'Fernández','104', 'owner'),
    ('slopez_i',  'slopez.inq@example.com', 'Sofía',  'López',    '201', 'tenant'),
    ('slopez_p',  'slopez.prop@example.com','Santiago','López',   '201', 'owner'),
    ('pmartínez', 'pmartinez@example.com',  'Pedro',   'Martínez','202', 'owner'),
    ('lsánchez_i','lsanchez.inq@example.com','Laura', 'Sánchez',  '203', 'tenant'),
    ('lsánchez_p','lsanchez.prop@example.com','Leonardo','Sánchez','203','owner'),
    ('erosario',  'erosario@example.com',   'Elena',   'Rosario',  '204', 'owner'),
    ('fcastillo', 'fcastillo@example.com',  'Felipe',  'Castillo', '301', 'owner'),
    ('nvidal_i',  'nvidal.inq@example.com', 'Natalia', 'Vidal',    '302', 'tenant'),
    ('nvidal_p',  'nvidal.prop@example.com','Nicolás', 'Vidal',    '302', 'owner'),
    ('amorales',  'amorales@example.com',   'Andrea',  'Morales',  '303', 'owner'),
    ('rherrera_i','rherrera.inq@example.com','Ramón', 'Herrera',  '304', 'tenant'),
    ('rherrera_p','rherrera.prop@example.com','Rosa', 'Herrera',   '304', 'owner'),
]


class Command(BaseCommand):
    help = 'Carga datos de prueba de Confort S.A. (1 edificio, 12 apartamentos)'

    def handle(self, *args, **options):
        self.stdout.write('Limpiando datos previos...')
        Movement.objects.all().delete()
        MonthlyExpense.objects.all().delete()
        Resident.objects.all().delete()
        User.objects.filter(is_superuser=False).delete()
        Apartment.objects.all().delete()
        Building.objects.all().delete()

        total_coefficient = sum(Decimal(coef) for _, _, coef, _ in APARTMENTS)
        if total_coefficient != Decimal('1'):
            raise CommandError(f'Los coeficientes deben sumar 1, suman {total_coefficient}')

        self.stdout.write('Creando edificio...')
        building = Building.objects.create(
            name='Edificio Confort',
            address='Av. Brasil 2234',
        )

        self.stdout.write('Creando apartamentos...')
        apts = {}
        for number, floor, coef, is_rented in APARTMENTS:
            apt = Apartment.objects.create(
                building=building,
                number=number,
                floor=floor,
                ownership_coefficient=Decimal(coef),
                is_rented=is_rented,
            )
            apts[number] = apt

        self.stdout.write('Creando residentes...')
        for username, email, first, last, apt_number, role in RESIDENTS:
            user = User.objects.create_user(
                username=username,
                email=email,
                first_name=first,
                last_name=last,
                password='test1234',
            )
            Resident.objects.create(
                user=user,
                apartment=apts[apt_number],
                role=role,
            )

        self.stdout.write('Creando gastos de octubre 2026...')
        expense = MonthlyExpense.objects.create(
            building=building,
            billing_month=date(2026, 10, 1),
            ose_total=Decimal('4200.00'),
            ute_total=Decimal('8750.00'),
            cleaning_total=Decimal('12000.00'),
            fees_total=Decimal('18500.00'),
            extraordinary_total=Decimal('0.00'),
            reserve_fund_total=Decimal('6000.00'),
            notes='Liquidación ordinaria octubre 2026',
        )

        self.stdout.write('Generando cargos en el ledger...')
        ordinary_total = expense.total_ordinary
        reserve_total = expense.reserve_fund_total

        for apt in Apartment.objects.filter(building=building).select_related():
            coef = apt.ownership_coefficient
            residents = list(apt.residents.filter(is_active=True).select_related('user'))

            owners = [r for r in residents if r.role == Resident.Role.OWNER]
            tenants = [r for r in residents if r.role == Resident.Role.TENANT]

            if apt.is_rented and tenants:
                ordinary_charge = (ordinary_total * coef).quantize(Decimal('0.01'))
                Movement.objects.create(
                    resident=tenants[0],
                    date=date(2026, 10, 1),
                    movement_type=Movement.MovementType.CHARGE,
                    amount=-ordinary_charge,
                    payment_status=Movement.PaymentStatus.PENDING,
                    monthly_expense=expense,
                    notes=f'Gastos ordinarios octubre 2026 — Apto {apt.number}',
                )
                if owners:
                    reserve_charge = (reserve_total * coef).quantize(Decimal('0.01'))
                    Movement.objects.create(
                        resident=owners[0],
                        date=date(2026, 10, 1),
                        movement_type=Movement.MovementType.CHARGE,
                        amount=-reserve_charge,
                        payment_status=Movement.PaymentStatus.PENDING,
                        monthly_expense=expense,
                        notes=f'Fondo de reserva octubre 2026 — Apto {apt.number}',
                    )
            elif owners:
                total_charge = ((ordinary_total + reserve_total) * coef).quantize(Decimal('0.01'))
                Movement.objects.create(
                    resident=owners[0],
                    date=date(2026, 10, 1),
                    movement_type=Movement.MovementType.CHARGE,
                    amount=-total_charge,
                    payment_status=Movement.PaymentStatus.PENDING,
                    monthly_expense=expense,
                    notes=f'Gastos totales octubre 2026 — Apto {apt.number}',
                )

        # Simulate one completed payment
        first_resident = Resident.objects.filter(role=Resident.Role.OWNER).first()
        if first_resident:
            charge = Movement.objects.filter(resident=first_resident, movement_type=Movement.MovementType.CHARGE).first()
            if charge:
                Movement.objects.create(
                    resident=first_resident,
                    date=date(2026, 10, 15),
                    movement_type=Movement.MovementType.PAYMENT,
                    amount=abs(charge.amount),
                    payment_status=Movement.PaymentStatus.COMPLETED,
                    notes='Transferencia Scotiabank — comprobante validado',
                )

        self.stdout.write(self.style.SUCCESS(
            f'\n✓ Seed completado: 1 edificio, {Apartment.objects.count()} apartamentos, '
            f'{Resident.objects.count()} residentes, {Movement.objects.count()} movimientos'
        ))
