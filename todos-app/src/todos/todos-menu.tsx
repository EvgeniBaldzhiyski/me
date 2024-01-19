import React, { ChangeEvent, KeyboardEvent, useState } from 'react';
import {
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  MenuItem,
  MenuList,
  TextField
} from '@mui/material';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import DoneIcon from '@mui/icons-material/Done';
import { useDispatch } from 'react-redux';
import { addTodo, removeAllTodos, updateAllTodos } from '../redux/slices/todos.slice';

export default function TodosMenu() {
  const dispatch = useDispatch();

  const styles = {
    addNewTodoListItem: {
      justifyContent: 'space-between',
      position: 'relative'
    },
    addNewTodoButton: {
      position: 'absolute',
      top: '10px',
      right: '3px'
    }
  };

  const [title, setTitle] = useState<string>('');

  const onAllTodosChangeCompleted = (completed: boolean) => {
    dispatch(updateAllTodos({completed}));
  } 

  const onAllTodosRemove = () => {
    dispatch(removeAllTodos());
  } 

  const onAddNewTodoChange = (event: ChangeEvent<HTMLInputElement>) => {
    setTitle(event.target.value);
  }

  const onAddNewTodoUpdate = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      onSave();
    }
  }

  const onSave = () => {
    if (title.trim() !== '') {
      dispatch(addTodo({title, id: ''}));

      setTitle('');
    }
  }

  return (
    <>
      <MenuList>
        <MenuItem onClick={() => onAllTodosChangeCompleted(true)}>
          <ListItemIcon>
            <CheckBoxIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Mark all as resolved</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => onAllTodosChangeCompleted(false)}>
          <ListItemIcon>
            <CheckBoxOutlineBlankIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Mark all as unresolved</ListItemText>
        </MenuItem>
        <MenuItem onClick={onAllTodosRemove}>
          <ListItemIcon>
            <DeleteSweepIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Remove all todos</ListItemText>
        </MenuItem>
      </MenuList>

      <Divider />

      <List dense={true}>
        <ListItem sx={styles.addNewTodoListItem}>
          <TextField
            fullWidth
            value={title || ''}
            label="Add new todo"
            variant="standard"
            onChange={onAddNewTodoChange}
            onKeyUp={onAddNewTodoUpdate}/>

          <IconButton 
            sx={styles.addNewTodoButton}
            title='Done'
            onClick={onSave}
          >
            <DoneIcon />
          </IconButton>
        </ListItem>
      </List>
    </>
  );
}