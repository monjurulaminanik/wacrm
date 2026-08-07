---
name: Meta CAPI messaging behavior
description: Meta requirements for WhatsApp/Messenger business-messaging events and the fallback behavior used by this CRM.
---

Business-messaging CAPI events are stricter than classic Pixel events: Messenger requires a real page-scoped user ID (PSID), and Meta may require the Facebook Page to be associated with the Dataset. Until those conditions are satisfied, sending a classic hashed-identifier Lead event with `action_source=other` is the intentional fallback so inbound conversations still produce an attribution signal.

**Why:** Meta rejects synthetic PSIDs and unlinked Page/Dataset messaging payloads with generic parameter errors, which otherwise makes a working Pixel/token look broken.

**How to apply:** Keep connectivity tests and inbound event delivery tolerant of missing association/PSID, surface the linking requirement clearly, and only mark the dataset as messaging-associated after Meta accepts a real business-messaging event.