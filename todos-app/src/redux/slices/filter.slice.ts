import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface FilterStore {
  color: string;
  completed: number;
}

const initialState: FilterStore = {
  color: '',
  completed: -1,
};

export const filterSlice = createSlice({
  name: 'filter',
  initialState,
  reducers: {
    setFilterColor: (state, action: PayloadAction<string>) => {
      state.color = action.payload;
    },
    setFilterCompleted: (state, action: PayloadAction<number>) => {
      state.completed = action.payload;
    },
    clearFilter: (state) => {
      state.color = '';
      state.completed = -1;
    },
  },
});

export const { setFilterColor, setFilterCompleted, clearFilter } = filterSlice.actions;
export const selectFilter= (state: { filter: FilterStore }) => state.filter;

export default filterSlice.reducer;
