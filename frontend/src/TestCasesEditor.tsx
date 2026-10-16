export type AuthoredTest = {
  id: string;
  name: string;
  visibility: "public" | "hidden";
  category: "normal" | "boundary" | "negative";
  stdin: string;
  expected_stdout: string;
  fixture?: string | null;
};
export function TestCasesEditor({
  tests,
  onChange,
  fixture = false,
  disabled = false,
}: {
  tests: AuthoredTest[];
  onChange: (tests: AuthoredTest[]) => void;
  fixture?: boolean;
  disabled?: boolean;
}) {
  const edit = (index: number, patch: Partial<AuthoredTest>) =>
    onChange(
      tests.map((test, i) => (i === index ? { ...test, ...patch } : test)),
    );
  const add = (visibility: AuthoredTest["visibility"]) =>
    onChange([
      ...tests,
      {
        id: `test-${crypto.randomUUID().slice(0, 8)}`,
        name: "",
        visibility,
        category: "normal",
        stdin: "",
        expected_stdout: "",
        fixture: fixture ? "" : null,
      },
    ]);
  return (
    <div className="test-case-fields">
      <p className="muted-text">
        Sample tests are visible during practice. Hidden tests run on Submit.
        Publishing requires 3 samples and 5 hidden tests, with normal and
        boundary coverage.
      </p>
      {tests.map((t, i) => (
        <fieldset key={t.id} disabled={disabled}>
          <legend>
            {t.visibility === "public" ? "Sample" : "Hidden"} test {i + 1}
          </legend>
          <label>
            Name
            <input
              value={t.name}
              onChange={(e) => edit(i, { name: e.target.value })}
            />
          </label>
          <div className="two-columns">
            <label>
              Visibility
              <select
                value={t.visibility}
                onChange={(e) =>
                  edit(i, {
                    visibility: e.target.value as AuthoredTest["visibility"],
                  })
                }
              >
                <option value="public">Sample (public)</option>
                <option value="hidden">Hidden evaluation</option>
              </select>
            </label>
            <label>
              Coverage
              <select
                value={t.category}
                onChange={(e) =>
                  edit(i, {
                    category: e.target.value as AuthoredTest["category"],
                  })
                }
              >
                <option value="normal">Normal</option>
                <option value="boundary">Boundary</option>
                <option value="negative">Negative</option>
              </select>
            </label>
          </div>
          <label>
            Standard input
            <textarea
              rows={2}
              value={t.stdin}
              onChange={(e) => edit(i, { stdin: e.target.value })}
            />
          </label>
          <label>
            Expected standard output
            <textarea
              rows={2}
              value={t.expected_stdout}
              onChange={(e) => edit(i, { expected_stdout: e.target.value })}
            />
          </label>
          {fixture && (
            <label>
              C/C++ main fixture
              <textarea
                rows={4}
                value={t.fixture ?? ""}
                onChange={(e) => edit(i, { fixture: e.target.value })}
              />
            </label>
          )}
          <button
            type="button"
            onClick={() => onChange(tests.filter((_, n) => n !== i))}
          >
            Remove test
          </button>
        </fieldset>
      ))}
      <div className="button-row">
        <button
          type="button"
          disabled={disabled || tests.length >= 30}
          onClick={() => add("public")}
        >
          Add sample test
        </button>
        <button
          type="button"
          disabled={disabled || tests.length >= 30}
          onClick={() => add("hidden")}
        >
          Add hidden test
        </button>
      </div>
    </div>
  );
}
