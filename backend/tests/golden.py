import json
import os
from pathlib import Path


def load_demo():
    path = Path(os.environ.get('GOLDEN_PATH', '/golden/demo.json'))
    if not path.exists():
        raise FileNotFoundError(
            f'No se encontró el golden demo en {path}. '
            'Montá docs/golden o definí GOLDEN_PATH.'
        )
    with path.open(encoding='utf-8') as handle:
        return json.load(handle)
