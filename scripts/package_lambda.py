"""Build the HomeScope Lambda ZIP using Linux x86-64 wheels."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.build' / 'homescope.zip'
REQUIRED = {
    'api/main.py', 'api/auth.py', 'api/storage.py', 'api/sync_listings.py',
    'api/rentcast.py', 'api/alerts.py', 'seed_listings.json', 'web/index.html',
    'fastapi/__init__.py',
}


def main():
    OUTPUT.parent.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory() as directory:
        stage = Path(directory)
        subprocess.run([
            sys.executable, '-m', 'pip', 'install', '--disable-pip-version-check',
            '--platform', 'manylinux2014_x86_64', '--implementation', 'cp',
            '--python-version', '3.12', '--only-binary=:all:',
            '--target', str(stage), '-r', str(ROOT / 'api' / 'requirements.txt'),
        ], check=True)
        (stage / 'api').mkdir()
        for file in (ROOT / 'api').glob('*.py'):
            shutil.copy2(file, stage / 'api' / file.name)
        (stage / 'api' / '__init__.py').touch()

        (stage / 'web').mkdir()
        for name in ('index.html', 'styles.css', 'app.js', 'auth.js', 'auth-config.js'):
            shutil.copy2(ROOT / 'web' / name, stage / 'web' / name)
        shutil.copy2(ROOT / 'seed_listings.json', stage)

        with ZipFile(OUTPUT, 'w', ZIP_DEFLATED) as archive:
            for file in sorted(stage.rglob('*')):
                if file.is_file() and '__pycache__' not in file.parts:
                    archive.write(file, file.relative_to(stage))
    with ZipFile(OUTPUT) as archive:
        missing = REQUIRED - set(archive.namelist())
        if missing:
            raise RuntimeError(f'Lambda package missing {sorted(missing)}')
        if sum(entry.file_size for entry in archive.infolist()) >= 250 * 1024**2:
            raise RuntimeError('Lambda package exceeds the uncompressed size limit')
    print(OUTPUT)


if __name__ == '__main__':
    main()

