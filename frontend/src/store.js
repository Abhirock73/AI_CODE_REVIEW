import { configureStore, createSlice } from '@reduxjs/toolkit';
import authReducer from './features/authSlice';

const healthSlice = createSlice({
  name: 'health',
  initialState: {
    nodeHealth: null,
    aiHealth: null },
  reducers: {
    setNodeHealth: (state, action) => {
      state.nodeHealth = action.payload;
    },
    setAiHealth: (state, action) => {
      state.aiHealth = action.payload;
    } } });

export const { setNodeHealth, setAiHealth } = healthSlice.actions;

export const store = configureStore({
  reducer: {
    health: healthSlice.reducer,
    auth: authReducer } });
