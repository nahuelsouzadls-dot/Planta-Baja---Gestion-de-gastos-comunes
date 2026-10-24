def get_username(request, credentials):
    credentials = credentials or {}
    raw = (
        credentials.get('email')
        or credentials.get('username')
        or (request.POST.get('email') if request is not None else None)
        or (request.POST.get('username') if request is not None else None)
    )
    return raw.strip().lower() if isinstance(raw, str) and raw.strip() else None
