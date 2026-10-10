"""Normalize login identifiers without checking inbox ownership or deliverability."""
import re


def normalize_login_identifier(value: str) -> str:
    value = value.strip()
    if re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{2,31}', value):
        return value.lower()
    return normalize_identifier(value)


def normalize_identifier(value: str) -> str:
    value = value.strip()
    if '@' in value:
        if len(value) > 254 or not re.fullmatch(r'[^\s@\x00-\x1f\x7f<>()\[\],;:"\\]+@[\w.-]+', value):
            raise ValueError('请输入有效的邮箱或电话号码')
        return value.lower()
    phone = re.sub(r'[\s()（）-]', '', value)
    if phone.startswith('00'):
        phone = '+' + phone[2:]
    if not re.fullmatch(r'\+?[0-9]{7,15}', phone):
        raise ValueError('请输入有效的邮箱或电话号码')
    if re.fullmatch(r'1[0-9]{10}', phone):
        phone = '+86' + phone
    if phone.startswith('86') and len(phone) == 13:
        phone = '+' + phone
    if len(phone.lstrip('+')) < 7:
        raise ValueError('请输入有效的邮箱或电话号码')
    return phone if phone.startswith('+') else '+' + phone
