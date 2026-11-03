# Pruebas (Python) de reglas/deser-xxe.yml
import json
import pickle
import yaml
from lxml import etree


def f(data):
    # ruleid: tumi-py-pickle-loads
    pickle.loads(data)
    # ok: tumi-py-pickle-loads
    json.loads(data)
    # ruleid: tumi-py-yaml-unsafe-load
    yaml.load(data)
    # ok: tumi-py-yaml-unsafe-load
    yaml.load(data, Loader=yaml.SafeLoader)
    # ok: tumi-py-yaml-unsafe-load
    yaml.safe_load(data)
    # ruleid: tumi-py-xxe-lxml
    etree.XMLParser(resolve_entities=True)
    # ok: tumi-py-xxe-lxml
    etree.XMLParser(resolve_entities=False, no_network=True)
