/**
 * MCP Tool Registrations — 23 tools wrapping the SDF kernel.
 *
 * Every tool returns JSON with { shape_id, type, readback } so the LLM
 * always knows the current state after every operation.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  box, sphere, cylinder, cone, torus, plane,
  marchingCubes, exportSTL,
  type SDF, type TriangleMesh,
} from '@agent-cad/sdf-kernel';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as registry from './registry.js';

export function registerTools(server: McpServer): void {

  // ─── Primitives (6) ─────────────────────────────────────────

  server.tool(
    'create_box',
    'Create an axis-aligned box centered at origin. Dimensions in mm.',
    {
      width: z.number().positive().describe('Width (X dimension) in mm'),
      height: z.number().positive().describe('Height (Y dimension) in mm'),
      depth: z.number().positive().describe('Depth (Z dimension) in mm'),
      name: z.string().optional().describe('Optional name for the shape'),
    },
    async ({ width, height, depth, name }) => {
      const shape = box(width, height, depth);
      const result = registry.create(shape, 'box', name);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'create_sphere',
    'Create a sphere centered at origin.',
    {
      radius: z.number().positive().describe('Radius in mm'),
      name: z.string().optional().describe('Optional name for the shape'),
    },
    async ({ radius, name }) => {
      const shape = sphere(radius);
      const result = registry.create(shape, 'sphere', name);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'create_cylinder',
    'Create a cylinder centered at origin, aligned along Z axis.',
    {
      radius: z.number().positive().describe('Radius in mm'),
      height: z.number().positive().describe('Height in mm'),
      name: z.string().optional().describe('Optional name for the shape'),
    },
    async ({ radius, height, name }) => {
      const shape = cylinder(radius, height);
      const result = registry.create(shape, 'cylinder', name);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'create_cone',
    'Create a cone with tip at origin, base at -Z.',
    {
      base_radius: z.number().positive().describe('Base radius in mm'),
      height: z.number().positive().describe('Height in mm'),
      name: z.string().optional().describe('Optional name for the shape'),
    },
    async ({ base_radius, height, name }) => {
      const shape = cone(base_radius, height);
      const result = registry.create(shape, 'cone', name);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'create_torus',
    'Create a torus centered at origin in the XY plane.',
    {
      major_radius: z.number().positive().describe('Major radius (center to tube center) in mm'),
      minor_radius: z.number().positive().describe('Minor radius (tube radius) in mm'),
      name: z.string().optional().describe('Optional name for the shape'),
    },
    async ({ major_radius, minor_radius, name }) => {
      const shape = torus(major_radius, minor_radius);
      const result = registry.create(shape, 'torus', name);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'create_plane',
    'Create an infinite half-space. Points where dot(p, normal) < offset are inside.',
    {
      normal_x: z.number().describe('Normal X component'),
      normal_y: z.number().describe('Normal Y component'),
      normal_z: z.number().describe('Normal Z component'),
      offset: z.number().describe('Offset along normal'),
      name: z.string().optional().describe('Optional name for the shape'),
    },
    async ({ normal_x, normal_y, normal_z, offset, name }) => {
      const shape = plane([normal_x, normal_y, normal_z], offset);
      const result = registry.create(shape, 'plane', name);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  // ─── Booleans (3) ────────────────────────────────────────────

  server.tool(
    'boolean_union',
    'Combine two shapes. Use smooth_radius > 0 for filleted blend.',
    {
      shape_a: z.string().describe('ID of first shape'),
      shape_b: z.string().describe('ID of second shape'),
      smooth_radius: z.number().min(0).default(0).describe('Blend radius (0 = sharp)'),
      name: z.string().optional().describe('Optional name for result'),
    },
    async ({ shape_a, shape_b, smooth_radius, name }) => {
      const a = registry.get(shape_a).shape;
      const b = registry.get(shape_b).shape;
      const shape: SDF = smooth_radius > 0
        ? a.smoothUnion(b, smooth_radius)
        : a.union(b);
      const result = registry.create(shape, 'union', name);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'boolean_subtract',
    'Remove shape_b from shape_a. Use smooth_radius > 0 for filleted cut.',
    {
      shape_a: z.string().describe('ID of shape to cut from'),
      shape_b: z.string().describe('ID of shape to remove'),
      smooth_radius: z.number().min(0).default(0).describe('Blend radius (0 = sharp)'),
      name: z.string().optional().describe('Optional name for result'),
    },
    async ({ shape_a, shape_b, smooth_radius, name }) => {
      const a = registry.get(shape_a).shape;
      const b = registry.get(shape_b).shape;
      const shape: SDF = smooth_radius > 0
        ? a.smoothSubtract(b, smooth_radius)
        : a.subtract(b);
      const result = registry.create(shape, 'subtract', name);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'boolean_intersect',
    'Keep only the overlap of two shapes. Use smooth_radius > 0 for blend.',
    {
      shape_a: z.string().describe('ID of first shape'),
      shape_b: z.string().describe('ID of second shape'),
      smooth_radius: z.number().min(0).default(0).describe('Blend radius (0 = sharp)'),
      name: z.string().optional().describe('Optional name for result'),
    },
    async ({ shape_a, shape_b, smooth_radius, name }) => {
      const a = registry.get(shape_a).shape;
      const b = registry.get(shape_b).shape;
      const shape: SDF = smooth_radius > 0
        ? a.smoothIntersect(b, smooth_radius)
        : a.intersect(b);
      const result = registry.create(shape, 'intersect', name);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  // ─── Transforms (4) ──────────────────────────────────────────

  server.tool(
    'translate',
    'Move a shape. Returns a new shape (original unchanged).',
    {
      shape: z.string().describe('ID of shape to move'),
      x: z.number().describe('Translation in X (mm)'),
      y: z.number().describe('Translation in Y (mm)'),
      z: z.number().describe('Translation in Z (mm)'),
      name: z.string().optional().describe('Optional name for result'),
    },
    async ({ shape, x, y, z: tz, name }) => {
      const s = registry.get(shape).shape;
      const moved = s.translate(x, y, tz);
      const result = registry.create(moved, 'translate', name);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'rotate',
    'Rotate a shape around an axis. Returns a new shape.',
    {
      shape: z.string().describe('ID of shape to rotate'),
      axis: z.enum(['x', 'y', 'z']).describe('Rotation axis'),
      degrees: z.number().describe('Rotation angle in degrees'),
      name: z.string().optional().describe('Optional name for result'),
    },
    async ({ shape, axis, degrees, name }) => {
      const s = registry.get(shape).shape;
      let rotated: SDF;
      switch (axis) {
        case 'x': rotated = s.rotateX(degrees); break;
        case 'y': rotated = s.rotateY(degrees); break;
        case 'z': rotated = s.rotateZ(degrees); break;
      }
      const result = registry.create(rotated, 'rotate', name);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'scale_shape',
    'Uniformly scale a shape. Returns a new shape.',
    {
      shape: z.string().describe('ID of shape to scale'),
      factor: z.number().positive().describe('Scale factor (>0)'),
      name: z.string().optional().describe('Optional name for result'),
    },
    async ({ shape, factor, name }) => {
      const s = registry.get(shape).shape;
      const scaled = s.scale(factor);
      const result = registry.create(scaled, 'scale', name);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'mirror_shape',
    'Mirror a shape across an axis plane. Returns a new shape.',
    {
      shape: z.string().describe('ID of shape to mirror'),
      axis: z.enum(['x', 'y', 'z']).describe('Mirror axis'),
      name: z.string().optional().describe('Optional name for result'),
    },
    async ({ shape, axis, name }) => {
      const s = registry.get(shape).shape;
      const mirrored = s.mirror(axis);
      const result = registry.create(mirrored, 'mirror', name);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  // ─── Modifiers (3) ──────────────────────────────────────────

  server.tool(
    'shell',
    'Hollow out a shape to a given wall thickness.',
    {
      shape: z.string().describe('ID of shape to shell'),
      thickness: z.number().positive().describe('Wall thickness in mm'),
      name: z.string().optional().describe('Optional name for result'),
    },
    async ({ shape, thickness, name }) => {
      const s = registry.get(shape).shape;
      const shelled = s.shell(thickness);
      const result = registry.create(shelled, 'shell', name);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'round_edges',
    'Round/fillet all edges of a shape by offsetting the SDF.',
    {
      shape: z.string().describe('ID of shape to round'),
      radius: z.number().positive().describe('Rounding radius in mm'),
      name: z.string().optional().describe('Optional name for result'),
    },
    async ({ shape, radius, name }) => {
      const s = registry.get(shape).shape;
      const rounded = s.round(radius);
      const result = registry.create(rounded, 'round', name);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'elongate',
    'Stretch a shape along axes. Creates flat regions from curved surfaces.',
    {
      shape: z.string().describe('ID of shape to elongate'),
      x: z.number().min(0).describe('Elongation in X (mm)'),
      y: z.number().min(0).describe('Elongation in Y (mm)'),
      z: z.number().min(0).describe('Elongation in Z (mm)'),
      name: z.string().optional().describe('Optional name for result'),
    },
    async ({ shape, x, y, z: ez, name }) => {
      const s = registry.get(shape).shape;
      const elongated = s.elongate(x, y, ez);
      const result = registry.create(elongated, 'elongate', name);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  // ─── Queries (3) ─────────────────────────────────────────────

  server.tool(
    'get_shape',
    'Get full readback (name, bounds, size, center) for a shape.',
    {
      shape: z.string().describe('ID of shape to query'),
    },
    async ({ shape }) => {
      const entry = registry.get(shape);
      const readback = entry.shape.readback();
      const result = { shape_id: entry.id, type: entry.type, readback };
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'evaluate_point',
    'Evaluate the SDF at a point. Returns signed distance and inside/outside.',
    {
      shape: z.string().describe('ID of shape to evaluate'),
      x: z.number().describe('X coordinate'),
      y: z.number().describe('Y coordinate'),
      z: z.number().describe('Z coordinate'),
    },
    async ({ shape, x, y, z: pz }) => {
      const entry = registry.get(shape);
      const distance = entry.shape.evaluate([x, y, pz]);
      const result = {
        shape_id: entry.id,
        point: [x, y, pz],
        distance,
        inside: distance <= 0,
      };
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'drop_cutter',
    'Find Z where a point tool contacts the surface, searching downward from z_top to z_bottom.',
    {
      shape: z.string().describe('ID of shape'),
      x: z.number().describe('X position'),
      y: z.number().describe('Y position'),
      z_top: z.number().describe('Z start (top of search)'),
      z_bottom: z.number().describe('Z end (bottom of search)'),
    },
    async ({ shape, x, y, z_top, z_bottom }) => {
      const entry = registry.get(shape);
      const zContact = entry.shape.dropCutter(x, y, z_top, z_bottom);
      const result = {
        shape_id: entry.id,
        query: { x, y, z_top, z_bottom },
        z_contact: zContact,
        hit: zContact !== null,
      };
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  // ─── Mesh Export (2) ──────────────────────────────────────────

  server.tool(
    'compute_mesh',
    'Convert an SDF shape to a triangle mesh via marching cubes. Must be called before export_mesh.',
    {
      shape: z.string().describe('ID of shape to mesh'),
      resolution: z.number().min(0.1).max(10).default(2).describe('Voxel size in mm (0.1-10, default 2). Smaller = finer detail, slower.'),
      name: z.string().optional().describe('Optional name for the mesh result'),
    },
    async ({ shape, resolution, name }) => {
      const entry = registry.get(shape);
      const start = Date.now();
      const mesh = marchingCubes(entry.shape, resolution);
      const elapsed = Date.now() - start;
      const readback = entry.shape.readback();
      const result = {
        shape_id: name ?? entry.id,
        type: 'mesh',
        readback,
        mesh_info: {
          vertex_count: mesh.vertexCount,
          triangle_count: mesh.triangleCount,
          resolution_mm: resolution,
          computed_in_ms: elapsed,
          bounds: mesh.bounds,
        },
      };
      // Cache mesh on the registry entry
      registry.cacheMesh(entry.id, mesh);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'export_mesh',
    'Export a shape as binary STL file. You must call compute_mesh first — it will throw if no cached mesh exists.',
    {
      shape: z.string().describe('ID of shape to export'),
    },
    async ({ shape }) => {
      const entry = registry.get(shape);
      const mesh = registry.getMesh(entry.id);
      if (!mesh) {
        throw new Error(
          `No mesh cached for "${entry.id}". Call compute_mesh first to generate the mesh.`
        );
      }
      const stlBuffer = exportSTL(mesh);

      // Write to safe output directory
      const exportDir = path.join(process.env.TMPDIR ?? '/tmp', 'agent-cad');
      fs.mkdirSync(exportDir, { recursive: true });
      const safeId = entry.id.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `${safeId}-${Date.now()}.stl`;
      const filePath = path.join(exportDir, filename);
      fs.writeFileSync(filePath, Buffer.from(stlBuffer));

      const result = {
        shape_id: entry.id,
        type: 'stl_export',
        file_path: filePath,
        file_size_bytes: stlBuffer.byteLength,
        triangle_count: mesh.triangleCount,
        bounds: mesh.bounds,
      };
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  // ─── Session (2) ─────────────────────────────────────────────

  server.tool(
    'list_shapes',
    'List all shapes in the registry with their type and bounds.',
    {},
    async () => {
      const shapes = registry.list();
      return { content: [{ type: 'text', text: JSON.stringify({ count: shapes.length, shapes }) }] };
    }
  );

  server.tool(
    'delete_shape',
    'Remove a shape from the registry.',
    {
      shape: z.string().describe('ID of shape to delete'),
    },
    async ({ shape }) => {
      registry.remove(shape);
      return { content: [{ type: 'text', text: JSON.stringify({ deleted: shape, remaining: registry.list().length }) }] };
    }
  );
}
