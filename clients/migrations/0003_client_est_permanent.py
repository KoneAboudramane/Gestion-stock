from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('clients', '0002_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='client',
            name='est_permanent',
            field=models.BooleanField(default=True),
        ),
    ]
