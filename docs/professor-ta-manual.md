# Office Hours Queue: Professor and TA User Manual

This guide explains how administrators, professors, and TAs use the UNC STOR Office Hours Queue.

## Roles

The app has three staff-facing roles:

- **Administrator**: can manage course names, assign professors to courses, manage any course's TAs and roster, and export course data.
- **Professor**: can add or remove TAs for assigned courses, decide whether each TA receives queue email notifications, manage assigned course rosters, and view assigned course queues.
- **TA**: can view and manage only the courses assigned to them.

Students only see their own queue position, wait time, and how many people are ahead of them.

## Signing In

1. Open the queue website.
2. Sign in with UNC SSO if prompted.
3. After signing in, staff users should open the staff dashboard.
4. If your account has role switching enabled, use the **Role switch** panel to enter staff view.

If you cannot access the staff dashboard, your ONYEN may not be configured as an administrator, professor, or TA.

## Administrator Workflow

### Change Course Names

1. Go to the staff dashboard.
2. Find **Student course choices**.
3. Enter the course names students should choose from.
4. Separate courses with commas or spaces.

Examples:

```text
STOR113, STOR118, STOR666
```

or

```text
STOR113 STOR118 STOR666
```

5. Click **Update course choices**.

Students will see these courses in the course dropdown when joining the queue.

### Assign a Professor to a Course

1. Go to the staff dashboard.
2. Find **Course professors**.
3. Locate the course.
4. Enter the professor's ONYEN or UNC email address.
5. Optionally enter the professor's email address. If left blank, the app uses `<onyen>@unc.edu`.
6. Click **Assign professor**.

If an administrator changes the assigned professor for a course, previous TA assignments for that course are cleared.

### Export Course Data

1. Go to **Course professors**.
2. Locate the course.
3. Click **Export DB package**.

The export downloads a JSON package containing the course's professor assignment, TA assignments, roster settings, allowed students, and queue entries.

## Professor Workflow

Professors can manage only the courses assigned to them by an administrator.

### Add a TA to a Course

1. Go to the staff dashboard.
2. Find **Course TAs**.
3. Locate the course.
4. Enter the TA's ONYEN or UNC email address.
5. Optionally enter the TA's email address. If left blank, the app uses:

```text
<onyen>@unc.edu
```

6. Use the email checkbox to decide whether this TA should receive queue-join email notifications for that course.
7. Click **Add TA**.

After the TA is added, they can access the staff dashboard for that course.

### Remove a TA

1. Go to **Course TAs**.
2. Locate the TA under the correct course.
3. Click **Remove**.

Removing a TA also removes their access to that course's staff queue view.

### Manage Course Roster Access

1. Go to **Course rosters**.
2. Locate the course.
3. Use **Only roster students can join** to decide whether the queue is restricted.
4. Click **Save roster rule**.

When roster restriction is off, any signed-in UNC student can join the course queue. When it is on, only students in the allowed-student list for that course can join.

### Import Students from Canvas CSV

1. Download a Canvas gradebook CSV for the course.
2. Go to **Course rosters**.
3. Choose the CSV file under **Import Canvas CSV**.
4. Click **Import SIS Login IDs**.

The app reads the `SIS Login ID` column as the student's ONYEN.

### Manually Add an Allowed Student

1. Go to **Course rosters**.
2. Enter the student's ONYEN.
3. Optionally enter the student's name and email.
4. Click **Add allowed student**.

Manual entries and imported entries both allow the student to join when roster restriction is enabled.

## TA Workflow

### View Assigned Course Queues

1. Sign in with UNC SSO.
2. Open the staff dashboard.
3. The dashboard will show only the courses assigned to you.

If you are assigned to multiple courses, you can manage all of those courses from the same dashboard.

### Choose Queue View

The **Active queue** panel has two views:

- **Joined time**: shows all students from your assigned courses in one list, sorted by when they joined.
- **By course**: separates the queue by course. Each course is still sorted by join time.

Use **Joined time** when you want one global priority order.
Use **By course** when different TAs are helping different courses.

### Help a Student

1. Find the student in the active queue.
2. Review their course, help topic, location, and wait time.
3. Meet them in person or through the provided UNC Zoom link.
4. Click **Mark helped** when finished.

The entry moves to **Completed today**.

### Remove a Student from the Queue

Use **Remove** only when a student should no longer be active in the queue, for example:

- They left without using the **Leave queue** button.
- They joined by mistake.
- Their request was resolved outside the queue.

Removed entries are counted as students who left today.

## Dashboard Statistics

The dashboard includes live and daily statistics.

### Top Summary Cards

- **Waiting now**: number of active students currently in the queue.
- **Avg active wait**: average wait time for students still waiting.
- **Longest active wait**: longest current wait among active students.
- **Helped today**: number of students marked helped today.
- **Avg helped wait**: average wait time for completed visits today.
- **Longest helped wait**: longest completed wait time today.

### Course Snapshot

Each course card shows:

- Current number waiting.
- Average active wait for that course.
- Longest active wait for that course.
- Number helped today.
- Number who left today.
- Average completed wait today.

For TAs, these statistics only include assigned courses.

## Email Notifications

When a student joins the queue, the app can send an email notification.

Email recipients can include:

- Global queue notification recipients configured by the app administrator.
- Course-specific TAs whose email checkbox is enabled.

If a TA should not receive email notifications for a course, uncheck the email notification box when adding or updating that TA.

## Student View Notes

Students can:

- Choose a course from the dropdown.
- Describe what they need help with.
- Enter either **In person** or a valid UNC Zoom link.
- See only their own position and wait information.
- Leave the queue before being helped.

Students cannot see the full queue or other students' names.

## Recommended Operating Procedure

Before office hours:

1. Confirm the course list is correct.
2. Confirm TAs are assigned to the correct courses.
3. Confirm email notification settings are correct.
4. Ask each TA to sign in once and verify that their assigned courses appear.

During office hours:

1. Keep the staff dashboard open.
2. Use **Joined time** for first-come-first-served support.
3. Use **By course** when staffing is split by course.
4. Mark students helped as soon as their visit is complete.
5. Remove abandoned or mistaken entries.

After office hours:

1. Review **Completed today**.
2. Review average and longest wait times.
3. Adjust staffing or course assignments if wait times are too high.

## Troubleshooting

### A TA cannot access the staff dashboard

Check that the TA was added under the correct course and that the ONYEN or email address was entered correctly.

### A TA can access the dashboard but cannot see a course

The TA is probably not assigned to that specific course. A professor should add the TA under that course.

### A TA did not receive an email

Check:

1. The TA's email address is correct.
2. The email notification checkbox is enabled for that course.
3. The student joined the course assigned to that TA.
4. Global email notifications are enabled for the app.

### A student cannot join the queue

Common causes:

- The student is not signed in through UNC SSO.
- The location is not `In person` or a valid `https://unc.zoom.us/...` link.
- The student already has an active queue entry.

### The wrong course names appear

A professor should update **Student course choices** from the staff dashboard.
