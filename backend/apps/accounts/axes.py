def get_username(request, credentials):
    email = credentials.get('email') or request.POST.get('email')
    return email.strip().lower() if email else None
