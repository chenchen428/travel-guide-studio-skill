#!/usr/bin/env python3
"""Render one self-contained travel guide from UTF-8 JSON (Python 3.9+)."""
import argparse
import datetime as dt
import json
from pathlib import Path


def render(input_path, output_path):
    data = json.loads(Path(input_path).read_text(encoding='utf-8'))
    for field in ('title', 'destination', 'eyebrow', 'intro', 'origin', 'asOf', 'status'):
        if not isinstance(data.get(field), str) or not data[field].strip():
            raise ValueError(f'{field}: expected non-empty text')
    if data.get('currency') != 'CNY':
        raise ValueError('currency: this template currently supports CNY')
    if data['status'] not in ('historical-example', 'draft', 'verified-plan'):
        raise ValueError('status: historical-example, draft or verified-plan')
    if type(data.get('travelers')) is not int or not 1 <= data['travelers'] <= 10:
        raise ValueError('travelers: expected integer 1–10')
    if type(data.get('nights')) is not int or data['nights'] < 0:
        raise ValueError('nights: expected non-negative integer')
    dt.date.fromisoformat(data['asOf'])
    if not data.get('days'):
        raise ValueError('days: at least one day is required')
    ids = set()
    previous = None
    dated = [day.get('date') is not None for day in data['days']]
    if any(dated) and not all(dated):
        raise ValueError('days.date: use all ISO dates or all null dates')
    for day in data['days']:
        for field in ('id', 'label', 'title', 'weather', 'temperature', 'kind', 'rest'):
            if not isinstance(day.get(field), str):
                raise ValueError(f'days.{field}: expected text')
        if day.get('date') is not None:
            date = dt.date.fromisoformat(day['date'])
            if previous and date != previous + dt.timedelta(days=1):
                raise ValueError('days: dates must be consecutive and ascending')
            previous = date
        if day['id'] in ids:
            raise ValueError('days: duplicate id')
        ids.add(day['id'])
        if not isinstance(day.get('stamina'), (int, float)) or not 0 <= day['stamina'] <= 5:
            raise ValueError('stamina: expected score 0–5')
        for field in ('alerts', 'stops', 'alternatives'):
            if not isinstance(day.get(field), list):
                raise ValueError(f'days.{field}: expected list')
        if not all(isinstance(a, str) for a in day['alerts']):
            raise ValueError('alerts: expected text entries')
        for stop in day['stops']:
            for field in ('time', 'type', 'name', 'transport', 'mapQuery'):
                if not isinstance(stop.get(field), str):
                    raise ValueError(f'stops.{field}: expected text')
            if not isinstance(stop.get('notes'), list) or not all(isinstance(n, str) for n in stop['notes']):
                raise ValueError('stops.notes: expected list')
        for alternative in day['alternatives']:
            if not all(isinstance(alternative.get(k), str) for k in ('q', 'a')):
                raise ValueError('alternatives: expected q and a strings')
    if data['status'] == 'historical-example' and not all(dated):
        raise ValueError('historical-example requires actual dates')
    for field in ('title', 'url', 'accessedAt', 'note'):
        if not isinstance(data.get('source', {}).get(field), str):
            raise ValueError(f'source.{field}: expected text')
    for field in ('checklist', 'principles'):
        if not isinstance(data.get(field), list):
            raise ValueError(f'{field}: expected list')
    for field in ('transport', 'food', 'practical', 'budget'):
        if not isinstance(data.get(field), dict):
            raise ValueError(f'{field}: expected object')
    checklist_ids = set()
    for item in data['checklist']:
        if not all(isinstance(item.get(k), str) for k in ('id', 'title', 'detail', 'deadline')):
            raise ValueError('checklist: expected id, title, detail, deadline strings')
        if item['id'] in checklist_ids:
            raise ValueError('checklist: duplicate id')
        checklist_ids.add(item['id'])
    for item in data['principles']:
        if not all(isinstance(item.get(k), str) for k in ('t', 'd')):
            raise ValueError('principles: expected t and d strings')
    budget = data['budget']
    if not budget.get('tiers') or budget.get('defaultTier') not in [t['id'] for t in budget['tiers']]:
        raise ValueError('budget.defaultTier: must refer to an existing tier')
    if not isinstance(budget.get('addons'), list) or not isinstance(budget.get('note'), str):
        raise ValueError('budget: addons list and note string are required')
    for tier in budget['tiers']:
        if not all(isinstance(tier.get(k), str) for k in ('id', 'name', 'description')):
            raise ValueError('budget.tiers: expected id, name, description')
        if not isinstance(tier.get('items'), list):
            raise ValueError('budget.tiers.items: expected list')
    for item in [i for t in budget['tiers'] for i in t['items']] + budget['addons']:
        if not all(isinstance(item.get(k), str) for k in ('id', 'name')):
            raise ValueError('budget.items: expected id and name')
        if item.get('basis') not in ('person', 'night', 'trip', 'person-day'):
            raise ValueError('budget.basis: person, night, trip or person-day')
        if type(item.get('amount')) not in (int, float) or item['amount'] < 0 or not float(item['amount']).is_integer() and round(item['amount'], 2) != item['amount']:
            raise ValueError('budget.amount: expected non-negative CNY amount with at most 2 decimals')
    map_data = data.get('map')
    if map_data is not None:
        if map_data.get('provider') != 'amap' or not map_data.get('browserKey'):
            raise ValueError('map: expected amap provider and browserKey')
        if not isinstance(map_data.get('pois'), list) or not map_data['pois'] or not isinstance(map_data.get('routes'), dict):
            raise ValueError('map: expected non-empty pois and routes')
        routes = map_data['routes']
        if not isinstance(routes.get('days'), list) or not isinstance(routes.get('alt'), list):
            raise ValueError('map.routes: expected days and alt arrays')
        if len(routes['days']) != len(data['days']):
            raise ValueError('map.routes.days: must cover every itinerary day')
        for index, route in enumerate(routes['days'], 1):
            if route.get('d') != index:
                raise ValueError('map.routes.days.d: expected consecutive day index')
        for point in map_data['pois'] + [s for r in routes['days'] + routes['alt'] for s in r['stops']]:
            if not isinstance(point.get('lng'), (int, float)) or not -180 <= point['lng'] <= 180:
                raise ValueError('map.lng: expected real longitude')
            if not isinstance(point.get('lat'), (int, float)) or not -90 <= point['lat'] <= 90:
                raise ValueError('map.lat: expected real latitude')
    elif data['status'] == 'verified-plan':
        raise ValueError('verified-plan: map data required for complete page delivery')
    template = Path(__file__).resolve().parents[1] / 'assets' / 'page-template.html'
    payload = json.dumps(data, ensure_ascii=False, allow_nan=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    html = template.read_text(encoding='utf-8').replace('__TRIP_DATA__', payload)
    asset_dir = template.parent
    html = html.replace('__MAP_CSS__', (asset_dir / 'route-map.css').read_text(encoding='utf-8'))
    html = html.replace('__MAP_JS__', (asset_dir / 'route-map.js').read_text(encoding='utf-8'))
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(html, encoding='utf-8')
    print(f'Generated: {output.resolve()} ({len(data["days"])} days)')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', help='trip JSON path')
    parser.add_argument('output', help='HTML output path')
    args = parser.parse_args()
    try:
        render(args.input, args.output)
    except (ValueError, KeyError, TypeError) as error:
        parser.exit(1, f'Invalid trip data: {error}\n')
