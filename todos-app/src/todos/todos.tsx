import React, { useEffect } from 'react';
import { Box, Divider, Paper, Typography } from '@mui/material';
import Sidebar from './todos-menu';
import TodosList from './todos-list';
import FilterBar from './todos-filter';
import { useDispatch } from 'react-redux';
import { TodoItem, addDefaultTodoCollection } from '../redux/slices/todos.slice';

export default function Todos() {
  const dispatch = useDispatch();

  const styles = {
    mainBox: {
      display: 'flex',
      height: '100%'
    },
    paper: {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      width: '300px'
    },
    header: {
      textAlign: 'center'
    },
    bodyWrapper: {
      display: 'flex',
      height: '100%',
      width: '100%',
      justifyContent: 'center'
    },
    todoListContainer: {
      width: '70%',
      maxWidth: '900px',
      height: '100%',
      position: 'relative'
    },
    filterBarContainer: {
      mt: '20%'
    }
  };

  useEffect(() => {
    (async () => {
      const res = await fetch('https://jsonplaceholder.typicode.com/todos');
      const data: TodoItem & {userId: number}[] = await res.json();

      dispatch(addDefaultTodoCollection(
        // because simplicity we reduce the list only to the items that belong to userId=1
        data.filter(todo => todo.userId === 1) as unknown as TodoItem[]
      ));
    })();
  });

  return (
    <Box sx={styles.mainBox}>
      <Paper elevation={3} sx={styles.paper}>
        <Typography variant="h2" sx={styles.header}>
          Todos
        </Typography>
        <Divider/>
        <Box>
          <Sidebar/>
        </Box>
        <Divider/>
        <Box sx={styles.filterBarContainer}>
          <FilterBar/>
        </Box>
      </Paper>
      <Box sx={styles.bodyWrapper}>
        <Box sx={styles.todoListContainer}>
          <TodosList/>
        </Box>
      </Box>
    </Box>
  );
}
