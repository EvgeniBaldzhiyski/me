import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { v4 } from 'uuid';

interface TodoUpdatePayload {
  id?: string;
  color?: string;
  completed?: boolean;
  title?: string;
}

export interface TodoItem {
  id: string;
  title: string;
  completed?: boolean;
  color?: string;   
};

interface TodoCollections {
  defaultTodos: TodoItem[];
  workTodos: TodoItem[];
}

const initialState: TodoCollections = {
  defaultTodos: [],
  workTodos: [],
};

export const todoSlice = createSlice({
  name: 'todos',
  initialState,
  reducers: {
    addTodo: (state, action: PayloadAction<TodoItem>) => {
      state.workTodos.push({
        ...action.payload,
        id: action.payload.id || v4(),
        completed: action.payload.completed || false,
        color: action.payload.color || '',
      });
    },
    removeTodo: (state, action: PayloadAction<string>) => {
      state.workTodos = state.workTodos.filter(todo => todo.id !== action.payload);
    },
    removeAllTodos: (state) => {
      state.workTodos = [];
    },
    updateTodo: (state, action: PayloadAction<TodoUpdatePayload>) => {
      state.workTodos = state.workTodos.map(todo => {
        if (todo.id !== action.payload.id) {
          return todo;
        }
        return {
          ...todo,
          ...action.payload
        };
      });
    },
    updateAllTodos: (state, action: PayloadAction<TodoUpdatePayload>) => {
      state.workTodos = state.workTodos.map(todo => {
        return {
          ...todo,
          ...action.payload
        };
      });
    },
    resetTodos: (state) => {
      state.workTodos = state.defaultTodos;
    },
    addDefaultTodoCollection: (state, action: PayloadAction<TodoItem[]>) => {
      const sanitizeCollection = action.payload.map(todo => ({
        ...todo,
        id: String(todo.id || ''),
        title: todo.title || `Todo ${todo.id}`,
        color: todo.color || '',
        completed: todo.completed || false,
      }));

      state.defaultTodos = sanitizeCollection;
      state.workTodos = sanitizeCollection;
    }
  },
});

export const {
  addTodo,
  removeTodo,
  updateTodo,
  resetTodos,
  addDefaultTodoCollection,
  updateAllTodos,
  removeAllTodos
} = todoSlice.actions;
export const selectTodos = (state: { todos: TodoCollections }) => state.todos.workTodos;

export default todoSlice.reducer;
