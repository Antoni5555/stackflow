from django.urls import path

from . import views


app_name = 'trainers'

urlpatterns = [
    path('playground/', views.PlaygroundView.as_view(), name='playground'),
    path(
        'playground/practice/<slug:course>/<slug:section>/<slug:topic>/',
        views.PracticeView.as_view(), name='practice',
    ),
    # задача лежит «внутри» темы курса: /courses/python/first-steps/strings/sku-parts/
    path(
        'courses/<slug:course>/<slug:section>/<slug:topic>/<slug:exercise>/',
        views.ExerciseView.as_view(), name='exercise',
    ),
]
