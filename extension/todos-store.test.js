'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  completeTodo,
  clearArchivedTodos,
  createTodo,
  deleteTodo,
  editTodo,
  normalizeTodos,
  searchTodos,
  splitTodos,
  unarchiveTodo,
} = require('./todos-store.js');

test('createTodo adds a new active todo with title and description', () => {
  const todos = createTodo([], {
    title: 'Write launch post',
    description: 'Draft the outline before dinner',
  });

  assert.equal(todos.length, 1);
  assert.equal(todos[0].title, 'Write launch post');
  assert.equal(todos[0].completed, false);
});

test('completeTodo archives a todo without dismissing it', () => {
  const todos = completeTodo([
    {
      id: 'todo-1',
      title: 'Review notes',
      description: '',
      createdAt: '2026-04-16T00:00:00.000Z',
      completed: false,
      completedAt: null,
      dismissed: false,
    },
  ], 'todo-1');

  const { active, archived } = splitTodos(todos);
  assert.equal(active.length, 0);
  assert.equal(archived.length, 1);
  assert.equal(archived[0].completed, true);
});

test('deleteTodo hides a todo from both active and archive views', () => {
  const todos = deleteTodo([
    {
      id: 'todo-1',
      title: 'Review notes',
      description: '',
      createdAt: '2026-04-16T00:00:00.000Z',
      completed: true,
      completedAt: '2026-04-16T01:00:00.000Z',
      dismissed: false,
    },
  ], 'todo-1');

  const { active, archived } = splitTodos(todos);
  assert.equal(active.length, 0);
  assert.equal(archived.length, 0);
});

test('clearArchivedTodos removes all archived todos but keeps active ones', () => {
  const todos = clearArchivedTodos([
    {
      id: 'todo-1',
      title: 'Archived item',
      description: '',
      createdAt: '2026-04-16T00:00:00.000Z',
      completed: true,
      completedAt: '2026-04-16T01:00:00.000Z',
      dismissed: false,
    },
    {
      id: 'todo-2',
      title: 'Active item',
      description: '',
      createdAt: '2026-04-16T00:00:00.000Z',
      completed: false,
      completedAt: null,
      dismissed: false,
    },
  ]);

  const { active, archived } = splitTodos(todos);
  assert.equal(active.length, 1);
  assert.equal(archived.length, 0);
});

test('searchTodos matches title and description text', () => {
  const todos = normalizeTodos([
    {
      id: 'todo-1',
      title: 'Write docs',
      description: 'Update onboarding page',
      createdAt: '2026-04-16T00:00:00.000Z',
      completed: false,
      completedAt: null,
      dismissed: false,
    },
    {
      id: 'todo-2',
      title: 'Prep launch',
      description: 'Draft release copy',
      createdAt: '2026-04-16T00:00:00.000Z',
      completed: false,
      completedAt: null,
      dismissed: false,
    },
  ]);

  assert.equal(searchTodos(todos, 'onboarding').length, 1);
  assert.equal(searchTodos(todos, 'launch').length, 1);
});


test('editTodo trims active todo content and allows clearing details', () => {
  const original = [
    { id: 'todo-1', title: 'Old title', description: 'Old details', createdAt: '2026-04-16T00:00:00.000Z', completed: false, completedAt: null, dismissed: false },
  ];
  const todos = editTodo(original, 'todo-1', { title: '  New title  ', description: '   ' });

  assert.equal(todos[0].title, 'New title');
  assert.equal(todos[0].description, '');
  assert.equal(original[0].title, 'Old title');
  assert.ok(Date.parse(todos[0].updatedAt) >= Date.parse(original[0].createdAt));
  assert.notEqual(todos[0].updatedAt, original[0].createdAt);
});

test('editTodo rejects blank titles before changing the todo', () => {
  const original = [{ id: 'todo-1', title: 'Keep me', completed: false, updatedAt: '2026-04-16T00:00:00.000Z' }];
  assert.throws(
    () => editTodo(original, 'todo-1', { title: '   ' }),
    /Todo title is required/
  );
  assert.equal(original[0].title, 'Keep me');
  assert.equal(original[0].updatedAt, '2026-04-16T00:00:00.000Z');
});

test('editTodo does not edit archived or tombstoned todos', () => {
  const todos = editTodo([
    { id: 'archived', title: 'Archived', completed: true, completedAt: '2026-04-16T01:00:00.000Z' },
    { id: 'deleted', title: 'Deleted', completed: true, dismissed: true, deletedAt: '2026-04-16T02:00:00.000Z' },
  ], 'archived', { title: 'Changed' });

  assert.equal(todos[0].title, 'Archived');
  assert.equal(todos[1].title, 'Deleted');
});

test('unarchiveTodo restores a visible completed todo in place', () => {
  const todos = unarchiveTodo([
    { id: 'first', title: 'First', completed: false },
    { id: 'todo-1', title: 'Restore me', description: 'Keep details', createdAt: '2026-04-16T00:00:00.000Z', completed: true, completedAt: '2026-04-16T01:00:00.000Z', dismissed: false },
    { id: 'last', title: 'Last', completed: false },
  ], 'todo-1');

  assert.deepEqual(todos.map(todo => todo.id), ['first', 'todo-1', 'last']);
  assert.equal(todos[1].completed, false);
  assert.equal(todos[1].completedAt, null);
  assert.equal(todos[1].description, 'Keep details');
  assert.ok(Date.parse(todos[1].updatedAt) >= Date.parse(todos[1].createdAt));
  assert.notEqual(todos[1].updatedAt, todos[1].createdAt);
});

test('unarchiveTodo cannot revive dismissed or deleted tombstones', () => {
  const todos = unarchiveTodo([
    { id: 'dismissed', title: 'Dismissed', completed: true, dismissed: true },
    { id: 'deleted', title: 'Deleted', completed: true, deletedAt: '2026-04-16T02:00:00.000Z' },
  ], 'deleted');

  assert.equal(todos[0].completed, true);
  assert.equal(todos[1].completed, true);
  assert.equal(todos[1].deletedAt, '2026-04-16T02:00:00.000Z');
});
