"""API заметок (DRF). Вызывает js/note-editor.js; доступ — только вошедшим.

POST   /api/notes/       {"source": "python/first-steps/strings", "title": …, "body": …}
PATCH  /api/notes/<id>/  {"title": …, "body": …}
DELETE /api/notes/<id>/
Чужую заметку изменить или удалить нельзя: ищем только среди заметок пользователя.
"""
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Note
from .services import notes


class NoteSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=200, trim_whitespace=True)
    body = serializers.CharField(allow_blank=True, max_length=notes.MAX_BODY,
                                 trim_whitespace=False)


class CreateNoteSerializer(NoteSerializer):
    source = serializers.RegexField(r'^[a-z0-9-]+(/[a-z0-9-]+){0,3}$', max_length=400)


def note_json(note):
    return {'id': note.pk, 'title': note.title, 'body_html': note.body_html}


class NoteListView(APIView):
    """Создать заметку там, где пользователь сейчас (урок, задача, тренажёр)."""

    def post(self, request):
        serializer = CreateNoteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        source = notes.resolve_source(data['source'])
        if source is None:
            return Response({'detail': 'Не найдено, к чему относится заметка'},
                            status=status.HTTP_404_NOT_FOUND)
        note = notes.create_note(request.user, source, data['title'], data['body'])
        return Response(note_json(note), status=status.HTTP_201_CREATED)


class NoteDetailView(APIView):
    """Изменить или удалить свою заметку."""

    def get_note(self, request, pk):
        return get_object_or_404(Note, pk=pk, user=request.user)

    def patch(self, request, pk):
        note = self.get_note(request, pk)
        serializer = NoteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        notes.update_note(note, serializer.validated_data['title'],
                          serializer.validated_data['body'])
        return Response(note_json(note))

    def delete(self, request, pk):
        self.get_note(request, pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
