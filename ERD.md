# Reparo — Database ERD

> Render with any Mermaid-compatible viewer (GitHub, VS Code + Mermaid extension, mermaid.live)

```mermaid
erDiagram
    users {
        TEXT id PK
        TEXT first_name
        TEXT last_name
        TEXT email UK
        TEXT phone
        TEXT password
        TEXT role "Admin | Engineer | Customer"
        TEXT status "Active | Inactive | On Leave"
        DATETIME created_at
        DATETIME last_active
    }

    services {
        TEXT id PK
        TEXT cust_id FK
        TEXT cust_name
        TEXT cust_phone
        TEXT cust_email
        TEXT device_type
        TEXT brand
        TEXT model
        TEXT serial
        TEXT imei
        TEXT color
        TEXT warranty
        TEXT purchase_date
        TEXT issue_cat
        TEXT issue_desc
        TEXT diagnosis
        TEXT conditions "JSON array"
        TEXT accessories
        TEXT priority "Low | Medium | High"
        TEXT status "Received | Diagnosed | In Progress | Awaiting Parts | Ready | Dispatched"
        TEXT engineer_id FK
        TEXT engineer_name
        REAL cost
        TEXT contact_pref
        TEXT source
        TEXT notes
        DATETIME eta
        DATETIME dispatch_at
        DATETIME last_activity
        DATETIME created_at
    }

    service_activity {
        INTEGER id PK
        TEXT service_id FK
        TEXT text
        TEXT type "intake | status_change | diagnosis | reassign | note | dispatch"
        TEXT by_user
        DATETIME created_at
    }

    announcements {
        TEXT id PK
        TEXT text
        TEXT type "info | success | warning | danger"
        TEXT audience "All users | Customers only | Engineers only"
        INTEGER active "1 = visible, 0 = hidden"
        DATETIME created_at
    }

    audit_log {
        INTEGER id PK
        TEXT action
        TEXT user_email
        TEXT ip
        DATETIME created_at
    }

    settings {
        TEXT key PK
        TEXT value
    }

    users ||--o{ services : "customer (cust_id)"
    users ||--o{ services : "engineer (engineer_id)"
    services ||--o{ service_activity : "has activity"
```

## Relationships

| From | To | Type | Via |
|---|---|---|---|
| `users` | `services` | one-to-many | `cust_id` — customer who owns the service |
| `users` | `services` | one-to-many | `engineer_id` — engineer assigned to the service |
| `services` | `service_activity` | one-to-many | `service_id` — timeline entries per service (CASCADE delete) |

## Standalone Tables

| Table | Purpose |
|---|---|
| `announcements` | Portal-wide notices shown to customers and/or engineers |
| `audit_log` | Immutable record of all admin actions |
| `settings` | Key-value store for all configuration (branding, SMTP, notifications, etc.) |
