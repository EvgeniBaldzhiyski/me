import React, { ChangeEvent, useState } from 'react';
import {
  Checkbox,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Popover,
  Radio,
  TextField,
  Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import FlipCameraAndroidIcon from '@mui/icons-material/FlipCameraAndroid';
import { GithubPicker } from 'react-color';
import { useDispatch, useSelector } from 'react-redux';
import { removeTodo, resetTodos, selectTodos, updateTodo } from '../redux/slices/todos.slice';
import { selectFilter } from '../redux/slices/filter.slice';

export default function TodosList() {
  const colorPickerColors = ['',
    '#B80000', '#DB3E00', '#FCCB00', '#008B02',
    '#006B76', '#1273DE', '#004DCF', '#5300EB',
    '#EB9694', '#FAD0C3', '#FEF3BD', '#C1E1C5',
    '#BEDADC', '#C4DEF6', '#BED3F3',
  ];

  const styles = {
    refreshButton: {
      position: 'absolute',
      top: '0x',
      right: '-62px'
    },
    paper: {
      width: '100%',
      maxHeight: '96%',
      overflow: 'auto',
      margin: '2%'
    },
    list: {
      width: '100%'
    },
    emptyListItem: {
      justifyContent: 'center'
    }
  };

  const dispatch = useDispatch();

  const filter = useSelector(selectFilter);
  const todos = useSelector(selectTodos);
  const [editTodo, setEditTodo] = useState('');
  const [updateTitle, setUpdateTitle] = useState('');
  
  const filteredTodos = (filter.color === '' && filter.completed === -1) ? todos : todos.filter(todo => {
    if (filter.color !== '' && filter.color !== todo.color) {
      return false;
    }

    if (filter.completed !== -1 && Boolean(filter.completed) !== todo.completed) {
      return false;
    }
    
    return true;
  });

  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);

  const onColorPickerOpen = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const onColorPickerClose = () => {
    setAnchorEl(null);
  };

  const onTodoRemove = (id: string) => {
    dispatch(removeTodo(id));
  }

  const onTodoCompleteChange = (id: string, event: ChangeEvent<HTMLInputElement>) => {
    dispatch(updateTodo({id, completed: event.target.checked}));
  }

  const onTodoColorChange = (color: string) => {
    const sanitizeColor = color === '#000000' ? '' : color;

    setAnchorEl(null);
    dispatch(updateTodo({id: anchorEl?.children[0].id || '', color: sanitizeColor}));
  }

  const onDoubleClick = (id: string, title: string) => {
    setEditTodo(id);
    setUpdateTitle(title);
  }

  const onTodoTitleChange = (id: string, title: string) => {
    setUpdateTitle(title);
  }

  const onTodoTitleUpdate = (id: string, key: string) => {
    if (key === 'Enter' && updateTitle.trim() !== '') {
      dispatch(updateTodo({id, title: updateTitle}));
      setUpdateTitle('');
      setEditTodo('');
    }
  }

  const onResetTodos = () => {
    dispatch(resetTodos());
  }

  const renderList = () => {
    return (
      <List dense={true} sx={styles.list}> 
        {filteredTodos.map(({id, title, color, completed}) => {
          return (
            <ListItem
              key={id}
              disablePadding
              secondaryAction={
                <IconButton edge="end" onClick={() => onTodoRemove(id)}>
                  <DeleteIcon />
                </IconButton>
              }
            >
              <ListItemButton disableTouchRipple>
                <ListItemIcon>
                  <Checkbox 
                    checked={completed}
                    disableRipple
                    onChange={(event) => onTodoCompleteChange(id, event)}
                  />
                </ListItemIcon>

                <Radio id={String(id)} checked={true} onClick={onColorPickerOpen} disableTouchRipple sx={{
                  color: color || '#e2e2e2',
                  '&.Mui-checked': {
                    color: color || '#e2e2e2',
                  },
                }}/>
                {id === editTodo ? (
                  <TextField
                    fullWidth
                    label="Update todo"
                    value={updateTitle || ''}
                    variant="standard"
                    onChange={(event) => onTodoTitleChange(id, event.target.value)}
                    onKeyUp={(event) => onTodoTitleUpdate(id, event.key)}
                  />
                ) : (
                  <ListItemText
                    primary={title}
                    sx={{marginLeft: '8px'}}
                    onDoubleClick={() => onDoubleClick(id, title)}
                  />
                )}
              </ListItemButton>
            </ListItem>
          );
        })}
      </List>
    );
  };

  const renderListIsEmpty = () => {
    return (
      <List dense={true} sx={styles.list}>
         <ListItem sx={styles.emptyListItem}>
          <Typography>List is Empty</Typography>
         </ListItem>
      </List>
    );
  };

  return (
    <>
      <IconButton sx={styles.refreshButton} title='Reset Todos' onClick={onResetTodos}>
        <FlipCameraAndroidIcon />
      </IconButton>
      <Paper elevation={3} sx={styles.paper}>
        {filteredTodos.length ? renderList() : renderListIsEmpty()}
        <Popover
          open={!!anchorEl}
          anchorEl={anchorEl}
          onClose={onColorPickerClose}
          anchorOrigin={{
            vertical: 'bottom',
            horizontal: 'left',
          }}
        >
          <GithubPicker
            colors={colorPickerColors}
            onChangeComplete={(color) => onTodoColorChange(color.hex)}
          />
        </Popover>
      </Paper>
    </>
  );
}
