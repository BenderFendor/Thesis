
import json

with open('/home/bender/classwork/Thesis/backend/app/data/rss_sources.json.bak.20251016T152619Z') as f:
    backup_data = json.load(f)

with open('/home/bender/classwork/Thesis/backend/app/data/rss_sources.json') as f:
    current_data = json.load(f)

removed_sources = set(backup_data.keys()) - set(current_data.keys())

print("Removed Sources:")
for source in removed_sources:
    print(f"- {source}")
