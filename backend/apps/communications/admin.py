from django.contrib import admin

from .models import Claim, ClaimMessage, Notice, Task


class ClaimMessageInline(admin.TabularInline):
    model = ClaimMessage
    extra = 0
    can_delete = False
    readonly_fields = ('claim', 'author', 'from_admin', 'text', 'created_at')

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(Notice)
class NoticeAdmin(admin.ModelAdmin):
    list_display = ('created_at', 'building', 'title', 'published_by')
    list_filter = ('building',)
    list_select_related = ('building', 'published_by')

@admin.register(Claim)
class ClaimAdmin(admin.ModelAdmin):
    list_display = ('created_at', 'building', 'unit', 'author', 'kind', 'status')
    list_filter = ('kind', 'status', 'building')
    list_select_related = ('building', 'unit', 'author')
    inlines = (ClaimMessageInline,)


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ('text', 'organization', 'building', 'due_date', 'done', 'created_by')
    list_filter = ('organization', 'building', 'done')
    list_select_related = ('organization', 'building', 'created_by')


@admin.register(ClaimMessage)
class ClaimMessageAdmin(admin.ModelAdmin):
    list_display = ('created_at', 'claim', 'author', 'from_admin')
    list_select_related = ('claim', 'author')
    readonly_fields = [field.name for field in ClaimMessage._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
