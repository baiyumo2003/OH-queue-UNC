process.env.DATABASE_URL ||= "postgresql://user:pass@localhost:5432/test";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getProfessorCoursesFromAssignments,
  normalizeEmail,
  normalizeIdentifier,
  parseRosterCsv,
  professorOptions,
  professorsByCourse
} = require("../src/courseAdminService");

test("parseRosterCsv imports SIS Login ID values as ONYENs", () => {
  const csv = [
    "Student,ID,SIS User ID,SIS Login ID,Section",
    "    Points Possible,,,,",
    '"Brown, Addison",203446,731039322,addicus,STOR113.001.S226',
    '"Cruz Trujillo, Ryan",179730,730877178,ruct,STOR113.001.S226'
  ].join("\n");

  assert.deepEqual(parseRosterCsv(csv), [
    {
      studentEmail: "addicus@unc.edu",
      studentIdentifier: "addicus",
      studentName: "Brown, Addison"
    },
    {
      studentEmail: "ruct@unc.edu",
      studentIdentifier: "ruct",
      studentName: "Cruz Trujillo, Ryan"
    }
  ]);
});

test("normalizeIdentifier and normalizeEmail handle UNC addresses", () => {
  assert.equal(normalizeIdentifier("TAUser@unc.edu"), "tauser");
  assert.equal(normalizeEmail("", "tauser"), "tauser@unc.edu");
});

test("professorsByCourse supports multiple professors per course", () => {
  const assignments = [
    { course_name: "STOR113", professor_identifier: "ada", professor_email: "ada@unc.edu" },
    { course_name: "STOR113", professor_identifier: "grace", professor_email: "grace@unc.edu" },
    { course_name: "STOR455", professor_identifier: "ada", professor_email: "ada@unc.edu" }
  ];

  const grouped = professorsByCourse(assignments);
  assert.deepEqual(
    grouped.get("STOR113").map((professor) => professor.professor_identifier),
    ["ada", "grace"]
  );
  assert.deepEqual(getProfessorCoursesFromAssignments(assignments, "ada@unc.edu"), ["STOR113", "STOR455"]);
});

test("professorOptions builds one selector option per professor", () => {
  const options = professorOptions([
    { course_name: "STOR455", professor_identifier: "grace", professor_email: "grace@unc.edu" },
    { course_name: "STOR113", professor_identifier: "ada", professor_email: "ada@unc.edu" },
    { course_name: "STOR455", professor_identifier: "ada", professor_email: "ada@unc.edu" }
  ]);

  assert.deepEqual(options, [
    {
      professor_identifier: "ada",
      professor_email: "ada@unc.edu",
      courseNames: ["STOR113", "STOR455"]
    },
    {
      professor_identifier: "grace",
      professor_email: "grace@unc.edu",
      courseNames: ["STOR455"]
    }
  ]);
});
