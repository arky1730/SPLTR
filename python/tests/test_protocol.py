from io import StringIO
import json

import pytest

from spltr_backend.protocol import EventWriter, parse_command


def test_event_writer_emits_one_json_object_per_line() -> None:
    stream = StringIO()
    EventWriter(stream).emit("ready", modelCached=True)
    assert json.loads(stream.getvalue()) == {"type": "ready", "modelCached": True}


def test_command_requires_type() -> None:
    with pytest.raises(ValueError):
        parse_command('{"settings": {}}')

