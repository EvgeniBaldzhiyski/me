import React from 'react';
import { createRoot } from 'react-dom/client';
import Todos from './todos/todos';

import './index.css';
import { Provider } from 'react-redux';
import { store } from './redux/store';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}>
      <Todos />
    </Provider>
    
  </React.StrictMode>
);
