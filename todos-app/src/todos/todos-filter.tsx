import React, { useState } from 'react';
import {
  Divider,
  FormControlLabel,
  IconButton,
  List,
  ListItem,
  Popover,
  Radio,
  RadioGroup,
  Typography
} from '@mui/material';
import ClearIcon from '@mui/icons-material/Clear';
import { GithubPicker } from 'react-color';
import { useDispatch, useSelector } from 'react-redux';
import { selectTodos } from '../redux/slices/todos.slice';
import {
  clearFilter,
  selectFilter,
  setFilterColor,
  setFilterCompleted
} from '../redux/slices/filter.slice';

export default function TodosFilter() {
  const dispatch = useDispatch ();

  const todos = useSelector(selectTodos);
  const filter = useSelector(selectFilter);

  const styles = {
    colorButton: {
      color: filter.color || '#e2e2e2',
      '&.Mui-checked': {
        color: filter.color || '#e2e2e2',
      },
    },
    filterListItem: {
      justifyContent: 'space-between'
    },
    filterTitle: {
      fontWeight: 'bold'
    }
  };

  const colorPickerColors = Array.from(
    todos.reduce((aggregate, todo) => aggregate.add(todo.color || ''), new Set<string>(['']))
  );

  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);

  const onColorPickerOpen = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const onColorPickerClose = () => {
    setAnchorEl(null);
  };

  const onCompleteFilterChange = (value: number) => {
    dispatch(setFilterCompleted(value));
  };
  
  const onColorFilterChange = (color: string) => {
    setAnchorEl(null);
    dispatch(setFilterColor(color === '#000000' ? '' : color));
  };

  const onClearFilter = () => {
    dispatch(clearFilter());
  }

  const colorButton = <Radio
    checked={true}
    disableTouchRipple 
    onClick={onColorPickerOpen}
    sx={styles.colorButton}
  />

  return (
    <>
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
          onChangeComplete={(color) => onColorFilterChange(color.hex)}
        />
      </Popover>
      <List dense={true}>
        <ListItem sx={styles.filterListItem}>
          <Typography sx={styles.filterTitle}>Filter</Typography>
          {(filter.color || filter.completed !== -1) && (
            <IconButton onClick={onClearFilter} title='Clear'>
              <ClearIcon />
            </IconButton>
          )}
        </ListItem>
        <Divider/>
        {colorPickerColors.length > 1 && (
          <>
            <ListItem>
              <FormControlLabel value="color" control={colorButton} label="color" />
            </ListItem>
            <Divider/>
          </>
        )}
        <ListItem>
          <RadioGroup
            defaultValue="all"
            value={filter.completed}
            onChange={(_, value) => onCompleteFilterChange(Number(value))}
          >
            <FormControlLabel value="-1" control={<Radio />} label="all" />
            <FormControlLabel value="1" control={<Radio />} label="resolved" />
            <FormControlLabel value="0" control={<Radio />} label="unresolved" />
          </RadioGroup>
        </ListItem>
        <Divider/>
      </List>
    </>
  );
}