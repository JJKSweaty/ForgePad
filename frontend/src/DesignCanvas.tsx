import { useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  applyNodeChanges,
  applyEdgeChanges,
} from "@xyflow/react";
import type {
  Node,
  Edge,
  Connection,
  NodeChange,
  EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Diagram, DiagramNode } from "./writtenWorkspace";
const flowNodes = (diagram: Diagram): Node[] =>
  diagram.nodes.map((n) => ({
    id: n.id,
    data: { label: n.label },
    position: { x: n.x, y: n.y },
    ariaLabel: `${n.label} component`,
  }));
const flowEdges = (diagram: Diagram): Edge[] =>
  diagram.edges.map((e) => ({
    ...e,
    markerEnd: { type: MarkerType.ArrowClosed },
    ariaLabel: `Connection ${e.label || e.source + " to " + e.target}`,
  }));
const serialize = (nodes: Node[], edges: Edge[]): Diagram => ({
  nodes: nodes.map((n) => ({
    id: n.id,
    label: String(n.data.label),
    x: n.position.x,
    y: n.position.y,
  })),
  edges: edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: typeof e.label === "string" ? e.label : "",
  })),
});
export default function DesignCanvas({
  diagram,
  onChange,
  readOnly = false,
}: {
  diagram: Diagram;
  onChange?: (diagram: Diagram) => void;
  readOnly?: boolean;
}) {
  const [nodes, setNodes] = useState(() => flowNodes(diagram));
  const [edges, setEdges] = useState(() => flowEdges(diagram));
  const [label, setLabel] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [edgeLabel, setEdgeLabel] = useState("");
  const [error, setError] = useState("");
  const current = useRef(diagram),
    past = useRef<Diagram[]>([]),
    future = useRef<Diagram[]>([]);
  current.current = diagram;
  useEffect(() => {
    setNodes((previous) =>
      flowNodes(diagram).map((n) => ({
        ...previous.find((p) => p.id === n.id),
        ...n,
      })),
    );
    setEdges((previous) =>
      flowEdges(diagram).map((e) => ({
        ...previous.find((p) => p.id === e.id),
        ...e,
      })),
    );
  }, [diagram]);
  function commit(next: Diagram, record = true) {
    if (
      readOnly ||
      !onChange ||
      JSON.stringify(next) === JSON.stringify(current.current)
    )
      return;
    if (record) {
      past.current = [...past.current.slice(-99), current.current];
      future.current = [];
    }
    current.current = next;
    setNodes((previous) =>
      flowNodes(next).map((node) => ({
        ...previous.find((p) => p.id === node.id),
        ...node,
      })),
    );
    setEdges((previous) =>
      flowEdges(next).map((edge) => ({
        ...previous.find((p) => p.id === edge.id),
        ...edge,
      })),
    );
    onChange(next);
    setError("");
  }
  function undo() {
    const previous = past.current.pop();
    if (previous) {
      future.current.push(current.current);
      commit(previous, false);
    }
  }
  function redo() {
    const next = future.current.pop();
    if (next) {
      past.current.push(current.current);
      commit(next, false);
    }
  }
  function remove(nodeIds: Set<string>, edgeIds = new Set<string>()) {
    commit({
      nodes: current.current.nodes.filter((n) => !nodeIds.has(n.id)),
      edges: current.current.edges.filter(
        (e) =>
          !edgeIds.has(e.id) &&
          !nodeIds.has(e.source) &&
          !nodeIds.has(e.target),
      ),
    });
  }
  function connect(connection: Connection) {
    if (!connection.source || !connection.target) return;
    if (current.current.edges.length >= 200) {
      setError("A diagram supports up to 200 connections.");
      return;
    }
    commit({
      ...current.current,
      edges: [
        ...current.current.edges,
        {
          id: crypto.randomUUID(),
          source: connection.source,
          target: connection.target,
          label: edgeLabel.trim(),
        },
      ],
    });
    setEdgeLabel("");
  }
  function nodeChanges(changes: NodeChange[]) {
    const next = applyNodeChanges(changes, nodes);
    setNodes(next);
    if (
      changes.some((change) => change.type === "position" && !change.dragging)
    )
      commit(serialize(next, edges));
  }
  function edgeChanges(changes: EdgeChange[]) {
    setEdges(applyEdgeChanges(changes, edges));
  }
  function patchNode(id: string, patch: Partial<DiagramNode>) {
    commit({
      ...current.current,
      nodes: current.current.nodes.map((n) =>
        n.id === id ? { ...n, ...patch } : n,
      ),
    });
  }
  return (
    <section
      className={`design-canvas ${readOnly ? "canvas-readonly" : ""}`}
      aria-label={
        readOnly ? "Submitted architecture diagram" : "Architecture diagram"
      }
    >
      {!readOnly && (
        <div className="canvas-toolbar">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!label.trim() || diagram.nodes.length >= 100) return;
              const index = diagram.nodes.length;
              commit({
                ...diagram,
                nodes: [
                  ...diagram.nodes,
                  {
                    id: crypto.randomUUID(),
                    label: label.trim(),
                    x: (index % 3) * 230,
                    y: Math.floor(index / 3) * 120,
                  },
                ],
              });
              setLabel("");
            }}
          >
            <label className="sr-only" htmlFor="component-label">
              New component label
            </label>
            <input
              id="component-label"
              value={label}
              maxLength={200}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Component name"
            />
            <button
              type="submit"
              disabled={!label.trim() || diagram.nodes.length >= 100}
            >
              Add component
            </button>
          </form>
          <button type="button" disabled={!past.current.length} onClick={undo}>
            Undo diagram
          </button>
          <button
            type="button"
            disabled={!future.current.length}
            onClick={redo}
          >
            Redo diagram
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <div
        className="canvas-surface"
        onKeyDown={(event) => {
          if (
            readOnly ||
            (event.target as HTMLElement).closest("input,textarea,select")
          )
            return;
          if (
            (event.metaKey || event.ctrlKey) &&
            event.key.toLowerCase() === "z"
          ) {
            event.preventDefault();
            event.stopPropagation();
            event.shiftKey ? redo() : undo();
          }
          if (event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault();
            remove(
              new Set(nodes.filter((n) => n.selected).map((n) => n.id)),
              new Set(edges.filter((e) => e.selected).map((e) => e.id)),
            );
          }
        }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={readOnly ? undefined : nodeChanges}
          onEdgesChange={readOnly ? undefined : edgeChanges}
          onNodeDragStop={(_, node) =>
            commit(
              serialize(
                nodes.map((n) => (n.id === node.id ? node : n)),
                edges,
              ),
            )
          }
          onConnect={readOnly ? undefined : connect}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          edgesReconnectable={false}
          deleteKeyCode={null}
          fitView
          fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
          minZoom={0.15}
          maxZoom={2}
          aria-label={
            readOnly ? "Saved component graph" : "Editable component graph"
          }
        >
          <Background gap={20} />
          <Controls showInteractive={false} />
        </ReactFlow>
        {!nodes.length && (
          <p className="canvas-empty">
            {readOnly
              ? "No diagram submitted."
              : "Add a component to start your architecture. Connect its output handle to another component’s input."}
          </p>
        )}
      </div>
      <details className="canvas-outline">
        <summary>
          Components &amp; connections · {diagram.nodes.length} components,{" "}
          {diagram.edges.length} connections
        </summary>
        <p className="muted-text">
          {readOnly
            ? "Saved with this submission."
            : "Use this list to edit without dragging. On the canvas, Tab selects a component and arrow keys move it."}
        </p>
        <ul>
          {diagram.nodes.map((n) => (
            <li key={n.id}>
              <strong>{n.label}</strong>
              {!readOnly && (
                <div className="canvas-node-fields">
                  <label>
                    Label
                    <input
                      aria-label={`Label for ${n.label}`}
                      defaultValue={n.label}
                      key={n.label}
                      maxLength={200}
                      onBlur={(event) => {
                        const name = event.target.value.trim();
                        if (name) patchNode(n.id, { label: name });
                        else {
                          event.target.value = n.label;
                          setError("Give each component a label.");
                        }
                      }}
                    />
                  </label>
                  {(["x", "y"] as const).map((axis) => (
                    <label key={axis}>
                      {axis.toUpperCase()}
                      <input
                        aria-label={`${axis.toUpperCase()} position for ${n.label}`}
                        type="number"
                        min={-100000}
                        max={100000}
                        defaultValue={n[axis]}
                        key={n[axis]}
                        onBlur={(event) => {
                          const value = Number(event.target.value);
                          if (
                            Number.isFinite(value) &&
                            Math.abs(value) <= 100000
                          )
                            patchNode(n.id, { [axis]: value });
                          else event.target.value = String(n[axis]);
                        }}
                      />
                    </label>
                  ))}
                  <button type="button" onClick={() => remove(new Set([n.id]))}>
                    Delete {n.label}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {!readOnly && (
          <form
            className="canvas-connection-form"
            onSubmit={(event) => {
              event.preventDefault();
              connect({
                source: from,
                target: to,
                sourceHandle: null,
                targetHandle: null,
              });
            }}
          >
            <label>
              From component
              <select
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              >
                <option value="">Choose source</option>
                {diagram.nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              To component
              <select
                value={to}
                onChange={(event) => setTo(event.target.value)}
              >
                <option value="">Choose target</option>
                {diagram.nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Connection label
              <input
                value={edgeLabel}
                maxLength={200}
                onChange={(event) => setEdgeLabel(event.target.value)}
              />
            </label>
            <button
              disabled={
                !diagram.nodes.some((n) => n.id === from) ||
                !diagram.nodes.some((n) => n.id === to) ||
                diagram.edges.length >= 200
              }
            >
              Add connection
            </button>
          </form>
        )}
        <ul>
          {diagram.edges.map((e) => (
            <li key={e.id}>
              <span>
                {diagram.nodes.find((n) => n.id === e.source)?.label} →{" "}
                {diagram.nodes.find((n) => n.id === e.target)?.label}
                {e.label ? `: ${e.label}` : ""}
              </span>
              {!readOnly && (
                <>
                  <input
                    aria-label={`Label for connection ${e.label || e.id}`}
                    defaultValue={e.label}
                    key={e.label}
                    maxLength={200}
                    onBlur={(event) =>
                      commit({
                        ...current.current,
                        edges: current.current.edges.map((edge) =>
                          edge.id === e.id
                            ? { ...edge, label: event.target.value }
                            : edge,
                        ),
                      })
                    }
                  />
                  <button
                    type="button"
                    onClick={() => remove(new Set(), new Set([e.id]))}
                  >
                    Delete connection {e.label || e.id}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
        {!readOnly &&
          (diagram.nodes.length >= 100 || diagram.edges.length >= 200) && (
            <p role="status">
              Diagram limit reached: 100 components and 200 connections.
            </p>
          )}
      </details>
    </section>
  );
}
