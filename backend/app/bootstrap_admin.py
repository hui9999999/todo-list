"""Create the explicitly selected administrator using owner credentials, never a public API."""
import argparse
import getpass
import sys
import re
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from .config import settings
from .models import User
from .auth import hasher


def main():
    parser = argparse.ArgumentParser(description='创建管理员账号（需要数据库维护权限）')
    parser.add_argument('username')
    parser.add_argument('--password-stdin', action='store_true', help='从标准输入读取密码，避免出现在命令行或源码中')
    args = parser.parse_args()
    username = args.username.strip().lower()
    if not re.fullmatch(r'[a-z][a-z0-9_]{2,31}', username):
        parser.error('账号须为 3–32 位字母、数字或下划线，且以字母开头')
    password = sys.stdin.readline().rstrip('\r\n') if args.password_stdin else getpass.getpass('管理员密码: ')
    if not 10 <= len(password) <= 128:
        parser.error('密码长度须为 10–128 个字符')
    engine = create_engine(settings().migration_database_url, hide_parameters=True)
    try:
        with Session(engine) as db, db.begin():
            existing = db.scalar(select(User).where(User.username == username))
            if existing:
                raise SystemExit('账号已存在；未修改现有账号或密码')
            db.add(User(username=username, is_admin=True, nickname='管理员', password_hash=hasher.hash(password),
                        verified=True, timezone='Asia/Shanghai'))
        print('管理员账号已创建: ' + username)
    finally:
        engine.dispose()


if __name__ == '__main__':
    main()
