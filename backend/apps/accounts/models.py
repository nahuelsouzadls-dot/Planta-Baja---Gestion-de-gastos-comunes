from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models
from django.db.models.functions import Lower

from apps.core.models import TimeStampedModel, UUIDModel


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _normalize_email(self, email):
        cleaned = self.normalize_email(email or '').strip().lower()
        if not cleaned:
            raise ValueError('El email es obligatorio.')
        return cleaned

    def create_user(self, email, password=None, **extra_fields):
        email = self._normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def get_by_natural_key(self, username):
        return self.get(email=self._normalize_email(username))

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault('is_staff', True)
        extra_fields.setdefault('is_superuser', True)
        if extra_fields.get('is_staff') is not True:
            raise ValueError('El superusuario debe tener is_staff=True.')
        if extra_fields.get('is_superuser') is not True:
            raise ValueError('El superusuario debe tener is_superuser=True.')
        return self.create_user(email, password, **extra_fields)


class User(UUIDModel, AbstractBaseUser, PermissionsMixin):
    email = models.EmailField(unique=True)
    first_name = models.CharField(max_length=150, blank=True)
    last_name = models.CharField(max_length=150, blank=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    date_joined = models.DateTimeField(auto_now_add=True)

    objects = UserManager()

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = []

    class Meta:
        constraints = [
            models.UniqueConstraint(Lower('email'), name='accounts_user_email_lower_unique'),
            models.CheckConstraint(
                condition=~models.Q(email='') & models.Q(email=Lower('email')),
                name='accounts_user_email_nonempty_lower',
            ),
        ]

    def save(self, *args, **kwargs):
        if self.email:
            self.email = self.email.strip().lower()
        super().save(*args, **kwargs)

    def __str__(self):
        return self.email


class Organization(TimeStampedModel):
    name = models.CharField(max_length=255)
    tax_id = models.CharField(max_length=32, blank=True)
    email = models.EmailField(blank=True)

    def __str__(self):
        return self.name


class OrgMembership(TimeStampedModel):
    user = models.ForeignKey(User, on_delete=models.PROTECT, related_name='org_memberships')
    organization = models.ForeignKey(
        Organization,
        on_delete=models.PROTECT,
        related_name='memberships',
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'organization'],
                name='accounts_membership_user_organization_unique',
            ),
        ]

    def __str__(self):
        return f'{self.user} - {self.organization}'


class Invitation(TimeStampedModel):
    class Kind(models.TextChoices):
        EMPLOYEE = 'employee', 'Empleado'
        RESIDENT = 'resident', 'Residente'

    organization = models.ForeignKey(
        Organization, on_delete=models.PROTECT, related_name='invitations'
    )
    kind = models.CharField(max_length=10, choices=Kind.choices)
    person = models.ForeignKey(
        'people.Person',
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name='invitations',
    )
    email = models.EmailField()
    first_name = models.CharField(max_length=150, blank=True)
    last_name = models.CharField(max_length=150, blank=True)
    token_hash = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        User, on_delete=models.PROTECT, related_name='created_invitations'
    )

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(kind='resident', person__isnull=False)
                    | models.Q(kind='employee', person__isnull=True)
                ),
                name='invitation_kind_person_consistent',
            ),
        ]

    def clean(self):
        super().clean()
        if self.email:
            self.email = self.email.strip().lower()

    def save(self, *args, **kwargs):
        self.email = self.email.strip().lower()
        super().save(*args, **kwargs)

    def __str__(self):
        return f'{self.email} ({self.kind})'
