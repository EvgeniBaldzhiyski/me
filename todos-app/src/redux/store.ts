import { configureStore } from '@reduxjs/toolkit';
import todoSlice from './slices/todos.slice';
import filterSlice from './slices/filter.slice';

export const store = configureStore({
  reducer: {
    todos: todoSlice,
    filter: filterSlice,
  },
});
