from django.contrib import admin

from .models import Parametre


@admin.register(Parametre)
class ParametreAdmin(admin.ModelAdmin):
    list_display = ("boutique", "cle", "valeur")
    search_fields = ("cle",)
    list_filter = ("boutique",)
