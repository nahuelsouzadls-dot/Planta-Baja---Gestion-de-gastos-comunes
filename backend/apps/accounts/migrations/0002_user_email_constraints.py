from django.db import migrations, models
from django.db.models.functions import Lower


class Migration(migrations.Migration):
    dependencies = [('accounts', '0001_initial')]

    operations = [
        migrations.AddConstraint(
            model_name='user',
            constraint=models.CheckConstraint(
                condition=~models.Q(email='') & models.Q(email=Lower('email')),
                name='accounts_user_email_nonempty_lower',
            ),
        ),
    ]
